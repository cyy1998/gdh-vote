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
import {
  createFinalElectionReport,
  ReportExportError,
} from "./report-export.js";
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
const batchBallotSubmissionSchema = ballotSubmissionSchema.extend({
  count: z.number().int().positive().max(1_000),
});
const withdrawalSchema = z.object({ groupId: groupIdSchema });
const resetSchema = z.object({
  password: z.string(),
  electionIds: z.array(electionIdSchema).min(1),
});
const electorLimitsSchema = z.object({
  password: z.string(),
  electorLimits: z.object({
    union: z.number().int().positive(),
    expense: z.number().int().positive(),
  }),
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
    if (error instanceof ReportExportError)
      return c.json({ error: error.message, code: "REPORT_EXPORT" }, 422);
    console.error(error);
    return c.json(
      { error: "服务器发生未预期错误", code: "INTERNAL_ERROR" },
      500,
    );
  });

  routes.get("/api/config", (c) => {
    const state = repository.syncState();
    return c.json({
      elections: Object.fromEntries(
        (Object.keys(ELECTIONS) as ElectionId[]).map((electionId) => [
          electionId,
          {
            ...ELECTIONS[electionId],
            electorLimit: state.electorLimits[electionId],
          },
        ]),
      ),
      recordingGroups: RECORDING_GROUPS,
      ...state,
    });
  });
  routes.get("/api/results/export", (c) => {
    const state = repository.syncState();
    const report = createFinalElectionReport({
      union: {
        result: repository.result("union"),
        electorLimit: state.electorLimits.union,
      },
      expense: {
        result: repository.result("expense"),
        electorLimit: state.electorLimits.expense,
      },
    });
    c.header(
      "content-type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    c.header(
      "content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent("上海燃气第二届工会选举计票结果报告单.docx")}`,
    );
    const body = report.buffer.slice(
      report.byteOffset,
      report.byteOffset + report.byteLength,
    ) as ArrayBuffer;
    return c.body(body);
  });
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
  routes.get("/api/recording-progress/:groupId", (c) => {
    const groupId = c.req.param("groupId") as RecordingGroupId;
    if (!RECORDING_GROUPS[groupId]) return c.json({ error: "未知录入组" }, 404);
    return c.json(repository.recordingProgress(groupId));
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
  routes.post("/api/ballots/batch", async (c) => {
    const parsed = batchBallotSubmissionSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json(
        {
          error: "批量录入数量必须是 1 到 1000 之间的整数",
          code: "BAD_REQUEST",
        },
        400,
      );
    const { groupId, draft, count } = parsed.data;
    return c.json(repository.submitBatch(groupId, draft, count), 201);
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
  routes.post("/api/admin/elector-limits", async (c) => {
    if (!options.adminPasswordHash)
      return c.json(
        { error: "管理员口令尚未配置", code: "ADMIN_NOT_CONFIGURED" },
        503,
      );
    const parsed = electorLimitsSchema.safeParse(
      await c.req.json().catch(() => undefined),
    );
    if (!parsed.success)
      return c.json(
        { error: "投票人数上限必须是正整数", code: "BAD_REQUEST" },
        400,
      );
    const { password, electorLimits } = parsed.data;
    if (!verifyPassword(password, options.adminPasswordHash))
      return c.json({ error: "管理员口令错误", code: "UNAUTHORIZED" }, 401);
    repository.updateElectorLimits(electorLimits);
    return c.json({ ok: true, ...repository.syncState() });
  });

  return app;
}
