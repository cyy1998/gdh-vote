import Database from "better-sqlite3";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import {
  ELECTIONS,
  RECORDING_GROUPS,
  formatBallotNumber,
  rankCandidates,
  validateDraft,
  type BallotDraft,
  type BallotNumber,
  type CandidateTotal,
  type Choice,
  type ElectionId,
  type RecordingGroupId,
  type RankedCandidate,
} from "../shared/domain.js";
import {
  ballotRecords,
  electionState,
  listedChoices,
  writeInChoices,
} from "./schema.js";

export class TallyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface BallotRecordView {
  id: number;
  ballotNumber: BallotNumber | null;
  electionId: ElectionId;
  groupId: RecordingGroupId;
  status: "active" | "withdrawn";
  valid: boolean;
  manualInvalid: boolean;
  submittedAt: string;
  withdrawnAt: string | null;
  choices: Record<string, Choice>;
  writeIns: string[];
}

export interface TallyResult {
  electionId: ElectionId;
  version: number;
  activeBallots: number;
  validBallots: number;
  invalidBallots: number;
  candidates: RankedCandidate[];
}

export interface RecordingProgress {
  groupId: RecordingGroupId;
  electionId: ElectionId;
  version: number;
  groupActiveBallots: number;
  electionActiveBallots: number;
  electorLimit: number;
}

export interface TallyRepository {
  submit(groupId: RecordingGroupId, draft: BallotDraft): BallotRecordView;
  submitBatch(
    groupId: RecordingGroupId,
    draft: BallotDraft,
    count: number,
  ): BallotRecordView[];
  history(groupId: RecordingGroupId): BallotRecordView[];
  recordingProgress(groupId: RecordingGroupId): RecordingProgress;
  withdraw(groupId: RecordingGroupId, ballotId: number): void;
  reset(electionIds: ElectionId[]): void;
  updateElectorLimits(limits: Record<ElectionId, number>): void;
  result(electionId: ElectionId): TallyResult;
  syncState(): {
    versions: Record<ElectionId, number>;
    generations: Record<ElectionId, number>;
    electorLimits: Record<ElectionId, number>;
  };
  close(): void;
}

export function createTallyRepository(
  filename: string,
  migrationsFolder = path.resolve("drizzle"),
): TallyRepository {
  const sqlite = new Database(filename);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  if (filename !== ":memory:") sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
  db.insert(electionState)
    .values([
      { electionId: "union", version: 1, generation: 1 },
      { electionId: "expense", version: 1, generation: 1 },
    ])
    .onConflictDoNothing()
    .run();

  const materialize = (
    row: typeof ballotRecords.$inferSelect,
  ): BallotRecordView => ({
    id: row.id,
    ballotNumber:
      row.status === "active"
        ? formatBallotNumber(row.groupId as RecordingGroupId, row.groupSequence)
        : null,
    electionId: row.electionId as ElectionId,
    groupId: row.groupId as RecordingGroupId,
    status: row.status as "active" | "withdrawn",
    valid: row.valid,
    manualInvalid: row.manualInvalid,
    submittedAt: row.submittedAt,
    withdrawnAt: row.withdrawnAt,
    choices: Object.fromEntries(
      db
        .select()
        .from(listedChoices)
        .where(eq(listedChoices.ballotId, row.id))
        .all()
        .map((choice) => [choice.candidateName, choice.choice as Choice]),
    ),
    writeIns: db
      .select()
      .from(writeInChoices)
      .where(eq(writeInChoices.ballotId, row.id))
      .all()
      .map((choice) => choice.displayName),
  });

  const submitBatch = (
    groupId: RecordingGroupId,
    draft: BallotDraft,
    batchSize: number,
  ) => {
    if (!Number.isInteger(batchSize) || batchSize <= 0)
      throw new TallyError("INVALID_BATCH_SIZE", "批量录入数量必须是正整数");
    const group = RECORDING_GROUPS[groupId];
    if (!group || group.electionId !== draft.electionId)
      throw new TallyError("GROUP_MISMATCH", "录入组与选举不匹配");
    const validation = validateDraft(draft);
    if (!validation.canSubmit)
      throw new TallyError("INVALID_DRAFT", validation.errors.join("；"));
    return db.transaction((tx) => {
      const state = tx
        .select()
        .from(electionState)
        .where(eq(electionState.electionId, draft.electionId))
        .get();
      if (!state) throw new TallyError("STATE_MISSING", "选举状态不存在");
      const activeBallotCount = tx
        .select({ value: count() })
        .from(ballotRecords)
        .where(
          and(
            eq(ballotRecords.electionId, draft.electionId),
            eq(ballotRecords.status, "active"),
          ),
        )
        .get()!.value;
      const remaining = state.electorLimit - activeBallotCount;
      if (batchSize > remaining) {
        if (batchSize === 1)
          throw new TallyError(
            "ELECTOR_LIMIT",
            `已达到 ${state.electorLimit} 张未撤销选票上限`,
          );
        throw new TallyError(
          "ELECTOR_LIMIT",
          `当前剩余可录入 ${Math.max(0, remaining)} 张，无法批量录入 ${batchSize} 张`,
        );
      }
      const occupiedGroupSequences = new Set(
        tx
          .select({ groupSequence: ballotRecords.groupSequence })
          .from(ballotRecords)
          .where(
            and(
              eq(ballotRecords.electionId, draft.electionId),
              eq(ballotRecords.groupId, groupId),
              eq(ballotRecords.status, "active"),
            ),
          )
          .all()
          .map(({ groupSequence }) => groupSequence),
      );
      const groupSequences: number[] = [];
      for (
        let sequence = 1;
        sequence <= state.electorLimit && groupSequences.length < batchSize;
        sequence += 1
      ) {
        if (!occupiedGroupSequences.has(sequence))
          groupSequences.push(sequence);
      }
      if (groupSequences.length < batchSize)
        throw new TallyError(
          "ELECTOR_LIMIT",
          `当前录入组没有足够的可用票号，无法批量录入 ${batchSize} 张`,
        );

      const submittedAt = new Date().toISOString();
      const rows = groupSequences.map((groupSequence) =>
        tx
          .insert(ballotRecords)
          .values({
            electionId: draft.electionId,
            groupSequence,
            groupId,
            status: "active",
            valid: validation.valid,
            manualInvalid: draft.manualInvalid,
            submittedAt,
          })
          .returning()
          .get(),
      );
      tx.insert(listedChoices)
        .values(
          rows.flatMap((row) =>
            ELECTIONS[draft.electionId].candidates.map((candidateName) => ({
              ballotId: row.id,
              candidateName,
              choice: draft.choices[candidateName],
            })),
          ),
        )
        .run();
      if (validation.normalizedWriteIns.length)
        tx.insert(writeInChoices)
          .values(
            rows.flatMap((row) =>
              validation.normalizedWriteIns.map((name) => ({
                ballotId: row.id,
                normalizedName: name,
                displayName: name,
              })),
            ),
          )
          .run();
      tx.update(electionState)
        .set({ version: state.version + batchSize })
        .where(eq(electionState.electionId, draft.electionId))
        .run();
      return rows.map(materialize);
    });
  };

  return {
    submit(groupId, draft) {
      return submitBatch(groupId, draft, 1)[0];
    },
    submitBatch(groupId, draft, batchSize) {
      return submitBatch(groupId, draft, batchSize);
    },
    history(groupId) {
      return db
        .select()
        .from(ballotRecords)
        .where(eq(ballotRecords.groupId, groupId))
        .orderBy(desc(ballotRecords.submittedAt), desc(ballotRecords.id))
        .all()
        .map(materialize);
    },
    recordingProgress(groupId) {
      const group = RECORDING_GROUPS[groupId];
      if (!group) throw new TallyError("NOT_FOUND", "未知录入组");
      return db.transaction((tx) => {
        const state = tx
          .select()
          .from(electionState)
          .where(eq(electionState.electionId, group.electionId))
          .get();
        if (!state) throw new TallyError("STATE_MISSING", "选举状态不存在");
        const groupActiveBallots = tx
          .select({ value: count() })
          .from(ballotRecords)
          .where(
            and(
              eq(ballotRecords.groupId, groupId),
              eq(ballotRecords.status, "active"),
            ),
          )
          .get()!.value;
        const electionActiveBallots = tx
          .select({ value: count() })
          .from(ballotRecords)
          .where(
            and(
              eq(ballotRecords.electionId, group.electionId),
              eq(ballotRecords.status, "active"),
            ),
          )
          .get()!.value;
        return {
          groupId,
          electionId: group.electionId,
          version: state.version,
          groupActiveBallots,
          electionActiveBallots,
          electorLimit: state.electorLimit,
        };
      });
    },
    withdraw(groupId, ballotId) {
      db.transaction((tx) => {
        const row = tx
          .select()
          .from(ballotRecords)
          .where(
            and(
              eq(ballotRecords.id, ballotId),
              eq(ballotRecords.groupId, groupId),
            ),
          )
          .get();
        if (!row) throw new TallyError("NOT_FOUND", "未找到本组的选票记录");
        if (row.status === "withdrawn")
          throw new TallyError("ALREADY_WITHDRAWN", "该选票记录已撤销");
        tx.update(ballotRecords)
          .set({ status: "withdrawn", withdrawnAt: new Date().toISOString() })
          .where(eq(ballotRecords.id, ballotId))
          .run();
        const state = tx
          .select()
          .from(electionState)
          .where(eq(electionState.electionId, row.electionId))
          .get()!;
        tx.update(electionState)
          .set({ version: state.version + 1 })
          .where(eq(electionState.electionId, row.electionId))
          .run();
      });
    },
    reset(electionIds) {
      db.transaction((tx) => {
        for (const electionId of electionIds) {
          tx.delete(ballotRecords)
            .where(eq(ballotRecords.electionId, electionId))
            .run();
          const state = tx
            .select()
            .from(electionState)
            .where(eq(electionState.electionId, electionId))
            .get()!;
          tx.update(electionState)
            .set({
              version: state.version + 1,
              generation: state.generation + 1,
            })
            .where(eq(electionState.electionId, electionId))
            .run();
        }
      });
    },
    updateElectorLimits(limits) {
      db.transaction((tx) => {
        for (const electionId of ["union", "expense"] as const) {
          const state = tx
            .select()
            .from(electionState)
            .where(eq(electionState.electionId, electionId))
            .get();
          if (!state) throw new TallyError("STATE_MISSING", "选举状态不存在");
          const activeBallotCount = tx
            .select({ value: count() })
            .from(ballotRecords)
            .where(
              and(
                eq(ballotRecords.electionId, electionId),
                eq(ballotRecords.status, "active"),
              ),
            )
            .get()!.value;
          const highestActiveGroupSequence =
            tx
              .select({ groupSequence: ballotRecords.groupSequence })
              .from(ballotRecords)
              .where(
                and(
                  eq(ballotRecords.electionId, electionId),
                  eq(ballotRecords.status, "active"),
                ),
              )
              .orderBy(desc(ballotRecords.groupSequence))
              .get()?.groupSequence ?? 0;
          const nextLimit = limits[electionId];
          if (!Number.isInteger(nextLimit) || nextLimit <= 0)
            throw new TallyError(
              "INVALID_ELECTOR_LIMIT",
              "投票人数上限必须是正整数",
            );
          const minimumLimit = Math.max(
            activeBallotCount,
            highestActiveGroupSequence,
          );
          if (nextLimit < minimumLimit) {
            const constraints = [
              activeBallotCount > nextLimit
                ? `当前有 ${activeBallotCount} 张未撤销选票`
                : null,
              highestActiveGroupSequence > nextLimit
                ? `最大组内序号为 ${highestActiveGroupSequence}`
                : null,
            ].filter(Boolean);
            throw new TallyError(
              "ELECTOR_LIMIT_BELOW_ACTIVE",
              `${ELECTIONS[electionId].shortName}${constraints.join("，")}，上限不能低于 ${minimumLimit}`,
            );
          }
          if (nextLimit === state.electorLimit) continue;
          tx.update(electionState)
            .set({ electorLimit: nextLimit, version: state.version + 1 })
            .where(eq(electionState.electionId, electionId))
            .run();
        }
      });
    },
    result(electionId) {
      const state = db
        .select()
        .from(electionState)
        .where(eq(electionState.electionId, electionId))
        .get()!;
      const active = db
        .select()
        .from(ballotRecords)
        .where(
          and(
            eq(ballotRecords.electionId, electionId),
            eq(ballotRecords.status, "active"),
          ),
        )
        .all();
      const valid = active.filter((row) => row.valid);
      const totals = new Map<string, CandidateTotal>(
        ELECTIONS[electionId].candidates.map((name) => [
          name,
          {
            name,
            kind: "listed",
            approvals: 0,
            oppositions: 0,
            abstentions: 0,
          },
        ]),
      );
      if (valid.length) {
        for (const choice of db
          .select()
          .from(listedChoices)
          .where(
            inArray(
              listedChoices.ballotId,
              valid.map((row) => row.id),
            ),
          )
          .all()) {
          const total = totals.get(choice.candidateName)!;
          if (choice.choice === "approval") total.approvals += 1;
          if (choice.choice === "opposition") total.oppositions += 1;
          if (choice.choice === "abstention") total.abstentions += 1;
        }
        for (const writeIn of db
          .select()
          .from(writeInChoices)
          .where(
            inArray(
              writeInChoices.ballotId,
              valid.map((row) => row.id),
            ),
          )
          .all()) {
          const total = totals.get(writeIn.displayName) ?? {
            name: writeIn.displayName,
            kind: "write-in" as const,
            approvals: 0,
            oppositions: 0,
            abstentions: 0,
          };
          total.approvals += 1;
          totals.set(writeIn.displayName, total);
        }
      }
      return {
        electionId,
        version: state.version,
        activeBallots: active.length,
        validBallots: valid.length,
        invalidBallots: active.length - valid.length,
        candidates: rankCandidates([...totals.values()]),
      };
    },
    syncState() {
      const states = db.select().from(electionState).all();
      const union = states.find((state) => state.electionId === "union")!;
      const expense = states.find((state) => state.electionId === "expense")!;
      return {
        versions: { union: union.version, expense: expense.version },
        generations: { union: union.generation, expense: expense.generation },
        electorLimits: {
          union: union.electorLimit,
          expense: expense.electorLimit,
        },
      };
    },
    close() {
      sqlite.close();
    },
  };
}
