import { scryptSync, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  ELECTIONS,
  RECORDING_GROUPS,
  type ElectionId,
  type RecordingGroupId,
} from "../shared/domain.js";
import { TallyError, type TallyRepository } from "./repository.js";

type SyncState = ReturnType<TallyRepository["syncState"]>;
type VersionListener = (state: SyncState) => void;

const electionIdSchema = z.enum(["union", "expense"]);
const groupIdSchema = z.enum(["union-1", "union-2", "union-3", "expense"]);
const ballotSubmissionSchema = z.object({
  groupId: groupIdSchema,
  draft: z.object({
    electionId: electionIdSchema,
    choices: z.record(
      z.string(),
      z.enum(["approval", "opposition", "abstention"]),
    ),
    writeIns: z.array(z.string()),
    manualInvalid: z.boolean(),
  }),
});
const withdrawalSchema = z.object({ groupId: groupIdSchema });
const resetSchema = z.object({
  password: z.string(),
  electionIds: z.array(electionIdSchema).min(1),
});

function verifyPassword(password: string, encoded?: string) {
  if (!encoded) return false;
  const [salt, expectedHex] = encoded.split(":");
  if (!salt || !expectedHex) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createApp(
  repository: TallyRepository,
  options: { adminPasswordHash?: string } = {},
) {
  const app = new Hono();
  const listeners = new Set<VersionListener>();
  const notify = () => {
    const state = repository.syncState();
    listeners.forEach((listener) => listener(state));
  };

  app.onError((error, c) => {
    if (error instanceof TallyError)
      return c.json(
        { error: error.message, code: error.code },
        error.code === "NOT_FOUND" ? 404 : 409,
      );
    console.error(error);
    return c.json(
      { error: "服务器发生未预期错误", code: "INTERNAL_ERROR" },
      500,
    );
  });

  app.get("/api/config", (c) =>
    c.json({
      elections: ELECTIONS,
      recordingGroups: RECORDING_GROUPS,
      ...repository.syncState(),
    }),
  );
  app.get("/api/results/:electionId", (c) => {
    const electionId = c.req.param("electionId") as ElectionId;
    if (!ELECTIONS[electionId]) return c.json({ error: "未知选举" }, 404);
    return c.json(repository.result(electionId));
  });
  app.get("/api/history/:groupId", (c) => {
    const groupId = c.req.param("groupId") as RecordingGroupId;
    if (!RECORDING_GROUPS[groupId]) return c.json({ error: "未知录入组" }, 404);
    return c.json(repository.history(groupId));
  });
  app.post("/api/ballots", async (c) => {
    const parsed = ballotSubmissionSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json({ error: "选票数据格式无效", code: "BAD_REQUEST" }, 400);
    const body = parsed.data;
    const record = repository.submit(body.groupId, body.draft);
    notify();
    return c.json(record, 201);
  });
  app.post("/api/ballots/:id/withdraw", async (c) => {
    const parsed = withdrawalSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json({ error: "撤销请求格式无效", code: "BAD_REQUEST" }, 400);
    const { groupId } = parsed.data;
    repository.withdraw(groupId, Number(c.req.param("id")));
    notify();
    return c.json({ ok: true });
  });
  app.post("/api/admin/reset", async (c) => {
    if (!options.adminPasswordHash)
      return c.json(
        { error: "管理员口令尚未配置", code: "ADMIN_NOT_CONFIGURED" },
        503,
      );
    const parsed = resetSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json({ error: "清空请求格式无效", code: "BAD_REQUEST" }, 400);
    const { password, electionIds } = parsed.data;
    if (!verifyPassword(password, options.adminPasswordHash))
      return c.json({ error: "管理员口令错误", code: "UNAUTHORIZED" }, 401);
    repository.reset([...new Set(electionIds)]);
    notify();
    return c.json({ ok: true, ...repository.syncState() });
  });
  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      let pending: ((state: SyncState) => void) | undefined;
      const listener: VersionListener = (state) => pending?.(state);
      listeners.add(listener);
      try {
        await stream.writeSSE({
          event: "version",
          data: JSON.stringify(repository.syncState()),
        });
        while (true) {
          const state = await new Promise<SyncState>((resolve) => {
            pending = resolve;
            setTimeout(() => resolve(repository.syncState()), 20_000);
          });
          await stream.writeSSE({
            event: "version",
            data: JSON.stringify(state),
          });
        }
      } finally {
        listeners.delete(listener);
      }
    }),
  );

  return app;
}
