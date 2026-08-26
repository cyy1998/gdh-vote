import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDefaultDraft } from "../shared/domain.js";
import { createTallyRepository, type TallyRepository } from "./repository.js";

const repositories: TallyRepository[] = [];

afterEach(() =>
  repositories.splice(0).forEach((repository) => repository.close()),
);

function createRepository() {
  const repository = createTallyRepository(":memory:");
  repositories.push(repository);
  return repository;
}

describe("tally repository", () => {
  it("submits a valid ballot and exposes it through history and tally results", () => {
    const repository = createRepository();
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.choices["元颖斌"] = "opposition";
    draft.choices["邢辉"] = "abstention";
    draft.choices["朱川红"] = "opposition";

    const submitted = repository.submit("union-1", draft);

    expect(submitted).toMatchObject({
      ballotNumber: 1,
      groupId: "union-1",
      valid: true,
      status: "active",
    });
    expect(repository.history("union-1")).toHaveLength(1);
    expect(repository.result("union")).toMatchObject({
      activeBallots: 1,
      validBallots: 1,
      invalidBallots: 0,
    });
    expect(
      repository
        .result("union")
        .candidates.find((candidate) => candidate.name === "王凯"),
    ).toMatchObject({ approvals: 0, oppositions: 1, abstentions: 0 });
    expect(
      repository
        .result("union")
        .candidates.find((candidate) => candidate.name === "邢辉"),
    ).toMatchObject({ approvals: 0, oppositions: 0, abstentions: 1 });
  });

  it("reuses a withdrawn ballot number and reset restarts from one", () => {
    const repository = createRepository();
    const draft = createDefaultDraft("expense");
    const initialGeneration = repository.syncState().generations.expense;
    const first = repository.submit("expense", draft);
    expect(repository.syncState().generations.expense).toBe(initialGeneration);
    repository.withdraw("expense", first.id);
    expect(repository.result("expense")).toMatchObject({ activeBallots: 0 });
    expect(repository.history("expense")).toContainEqual(
      expect.objectContaining({ id: first.id, ballotNumber: null }),
    );
    const replacement = repository.submit("expense", draft);
    expect(replacement).toMatchObject({ ballotNumber: 1, status: "active" });
    expect(replacement.id).not.toBe(first.id);
    repository.reset(["expense"]);
    expect(repository.syncState().generations.expense).toBe(
      initialGeneration + 1,
    );
    expect(repository.submit("expense", draft).ballotNumber).toBe(1);
  });

  it("allocates the smallest available ballot number across recording groups", () => {
    const repository = createRepository();
    repository.updateElectorLimits({ union: 5, expense: 5 });
    const draft = createDefaultDraft("union");
    draft.manualInvalid = true;

    const first = repository.submit("union-1", draft);
    const second = repository.submit("union-2", draft);
    expect(repository.submit("union-1", draft).ballotNumber).toBe(3);
    repository.withdraw("union-2", second.id);
    repository.withdraw("union-1", first.id);

    expect(repository.submit("union-3", draft).ballotNumber).toBe(1);
    expect(repository.submit("union-2", draft).ballotNumber).toBe(2);
    expect(repository.submit("union-3", draft).ballotNumber).toBe(4);
    expect(repository.submit("union-1", draft).ballotNumber).toBe(5);
    const activeBallotNumbers = (["union-1", "union-2", "union-3"] as const)
      .flatMap((groupId) => repository.history(groupId))
      .filter((record) => record.status === "active")
      .map((record) => record.ballotNumber!)
      .sort((first, second) => first - second);
    expect(activeBallotNumbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("counts overvotes and manual-invalid ballots without candidate totals", () => {
    const repository = createRepository();
    repository.submit("expense", createDefaultDraft("expense"));
    const manual = createDefaultDraft("union");
    manual.manualInvalid = true;
    repository.submit("union-1", manual);
    expect(repository.result("expense")).toMatchObject({
      activeBallots: 1,
      validBallots: 0,
      invalidBallots: 1,
    });
    expect(
      repository
        .result("expense")
        .candidates.every(
          (candidate) =>
            candidate.approvals === 0 &&
            candidate.oppositions === 0 &&
            candidate.abstentions === 0,
        ),
    ).toBe(true);
    expect(repository.result("union")).toMatchObject({
      activeBallots: 1,
      validBallots: 0,
      invalidBallots: 1,
    });
  });

  it("returns group and election recording counts from one progress snapshot", () => {
    const repository = createRepository();
    repository.updateElectorLimits({ union: 5, expense: 5 });
    const valid = createDefaultDraft("union");
    valid.choices["王凯"] = "opposition";
    valid.choices["元颖斌"] = "opposition";
    valid.choices["邢辉"] = "opposition";
    const invalid = createDefaultDraft("union");
    invalid.manualInvalid = true;

    const withdrawn = repository.submit("union-1", valid);
    repository.submit("union-1", invalid);
    repository.submit("union-2", valid);
    repository.withdraw("union-1", withdrawn.id);

    expect(repository.recordingProgress("union-1")).toMatchObject({
      groupId: "union-1",
      electionId: "union",
      groupActiveBallots: 1,
      electionActiveBallots: 2,
      electorLimit: 5,
    });
    expect(repository.recordingProgress("union-2")).toMatchObject({
      groupActiveBallots: 1,
      electionActiveBallots: 2,
    });
    repository.submit("expense", createDefaultDraft("expense"));
    expect(repository.recordingProgress("expense")).toMatchObject({
      groupActiveBallots: 1,
      electionActiveBallots: 1,
    });
  });

  it("enforces the configured active-ballot limit and allows another ballot after withdrawal", () => {
    const repository = createRepository();
    const draft = createDefaultDraft("expense");
    repository.updateElectorLimits({ union: 3, expense: 2 });
    const records = Array.from({ length: 2 }, () =>
      repository.submit("expense", draft),
    );
    expect(records.at(-1)?.ballotNumber).toBe(2);
    expect(() => repository.submit("expense", draft)).toThrow(
      "已达到 2 张未撤销选票上限",
    );
    repository.withdraw("expense", records[0].id);
    expect(repository.submit("expense", draft).ballotNumber).toBe(1);
  });

  it("rejects an elector limit below the highest active ballot number", () => {
    const repository = createRepository();
    const draft = createDefaultDraft("expense");
    repository.submit("expense", draft);
    const second = repository.submit("expense", draft);
    repository.submit("expense", draft);
    repository.withdraw("expense", second.id);

    expect(() =>
      repository.updateElectorLimits({ union: 10, expense: 0 }),
    ).toThrow("投票人数上限必须是正整数");
    expect(() =>
      repository.updateElectorLimits({ union: 10, expense: 2 }),
    ).toThrow("当前未撤销记录的最大票号为 3，上限不能低于该票号");
    expect(() =>
      repository.updateElectorLimits({ union: 10, expense: 3 }),
    ).not.toThrow();
  });

  it("restores submitted and withdrawn records after reopening the database", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "election-tally-test-"));
    const filename = path.join(directory, "tally.db");
    try {
      const firstSession = createTallyRepository(filename);
      const draft = createDefaultDraft("expense");
      const record = firstSession.submit("expense", draft);
      firstSession.withdraw("expense", record.id);
      firstSession.submit("expense", draft);
      firstSession.updateElectorLimits({ union: 170, expense: 160 });
      firstSession.close();

      const restarted = createTallyRepository(filename);
      expect(
        restarted
          .history("expense")
          .map(({ ballotNumber, status }) => ({ ballotNumber, status })),
      ).toEqual([
        { ballotNumber: 1, status: "active" },
        { ballotNumber: null, status: "withdrawn" },
      ]);
      expect(restarted.result("expense")).toMatchObject({ activeBallots: 1 });
      expect(restarted.syncState().electorLimits).toEqual({
        union: 170,
        expense: 160,
      });
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("ballot-number migration", () => {
  it("allows a new active record to reuse a withdrawn record's number", () => {
    const sqlite = new Database(":memory:");
    const applyMigration = (name: string) => {
      const sql = readFileSync(path.resolve("drizzle", name), "utf8");
      for (const statement of sql.split("--> statement-breakpoint"))
        if (statement.trim()) sqlite.exec(statement);
    };

    try {
      applyMigration("0000_fluffy_sandman.sql");
      applyMigration("0001_moaning_silver_sable.sql");
      applyMigration("0002_wonderful_purple_man.sql");
      sqlite
        .prepare(
          "insert into election_state (election_id, next_sequence, version, generation, elector_limit) values ('union', 4, 1, 1, 5)",
        )
        .run();
      const insertLegacyRecord = sqlite.prepare(
        "insert into ballot_record (election_id, sequence, group_id, status, valid, manual_invalid, submitted_at) values ('union', ?, 'union-1', ?, 1, 0, ?)",
      );
      insertLegacyRecord.run(1, "active", "2026-08-26T01:00:00.000Z");
      insertLegacyRecord.run(2, "active", "2026-08-26T01:01:00.000Z");
      insertLegacyRecord.run(3, "withdrawn", "2026-08-26T01:02:00.000Z");

      applyMigration("0003_stiff_devos.sql");

      const stateColumns = sqlite
        .prepare("pragma table_info(election_state)")
        .all() as Array<{ name: string }>;
      expect(stateColumns.map((column) => column.name)).not.toContain(
        "next_sequence",
      );
      expect(() =>
        insertLegacyRecord.run(3, "active", "2026-08-26T01:03:00.000Z"),
      ).not.toThrow();
      expect(() =>
        insertLegacyRecord.run(3, "active", "2026-08-26T01:04:00.000Z"),
      ).toThrow(/UNIQUE constraint failed/);
    } finally {
      sqlite.close();
    }
  });
});
