import { scryptSync, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  ELECTIONS,
  RECORDING_GROUPS,
  type ElectionId,
  type RecordingGroupId,
} from "../shared/domain.js";
import { normalizeBasePath } from "./base-path.js";
import { TallyError, type TallyRepository } from "./repository.js";

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
  options: {
    adminPasswordHash?: string;
    accessCredentials?: { username: string; password: string };
    basePath?: string;
  } = {},
) {
  const app = new Hono();
  if (options.accessCredentials) {
    app.use(
      "*",
      basicAuth({
        ...options.accessCredentials,
        realm: "Election Tallying",
        invalidUserMessage: "需要访问口令",
      }),
    );
  }
  const basePath = normalizeBasePath(options.basePath);
  const routes = basePath ? app.basePath(basePath) : app;

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
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

  routes.get("/api/config", (c) =>
    c.json({
      elections: ELECTIONS,
      recordingGroups: RECORDING_GROUPS,
      ...repository.syncState(),
    }),
  );
  routes.get("/api/results/:electionId", (c) => {
    const electionId = c.req.param("electionId") as ElectionId;
    if (!ELECTIONS[electionId]) return c.json({ error: "未知选举" }, 404);
    return c.json(repository.result(electionId));
  });
  routes.get("/api/history/:groupId", (c) => {
    const groupId = c.req.param("groupId") as RecordingGroupId;
    if (!RECORDING_GROUPS[groupId]) return c.json({ error: "未知录入组" }, 404);
    return c.json(repository.history(groupId));
  });
  routes.post("/api/ballots", async (c) => {
    const parsed = ballotSubmissionSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json({ error: "选票数据格式无效", code: "BAD_REQUEST" }, 400);
    const body = parsed.data;
    const record = repository.submit(body.groupId, body.draft);
    return c.json(record, 201);
  });
  routes.post("/api/ballots/:id/withdraw", async (c) => {
    const parsed = withdrawalSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json({ error: "撤销请求格式无效", code: "BAD_REQUEST" }, 400);
    const { groupId } = parsed.data;
    repository.withdraw(groupId, Number(c.req.param("id")));
    return c.json({ ok: true });
  });
  routes.post("/api/admin/reset", async (c) => {
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
    return c.json({ ok: true, ...repository.syncState() });
  });

  return app;
}
