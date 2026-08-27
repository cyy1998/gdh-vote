import { scryptSync } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultDraft } from "../shared/domain.js";
import { createApp } from "./app.js";
import { createTallyRepository, type TallyRepository } from "./repository.js";

let repository: TallyRepository | undefined;
afterEach(() => repository?.close());

describe("tally HTTP interface", () => {
  it("mounts API routes below the configured base path", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository, { basePath: "/gdh-vote/" });

    expect((await app.request("/api/results/union")).status).toBe(404);
    expect((await app.request("/gdh-vote/api/results/union")).status).toBe(200);
  });

  it("protects every API route with HTTP Basic Auth when configured", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository, {
      accessCredentials: { username: "shrq", password: "test-password" },
    });

    const unauthorized = await app.request("/api/results/union");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain("Basic");

    const authorization = `Basic ${Buffer.from("shrq:test-password").toString("base64")}`;
    const authorized = await app.request("/api/results/union", {
      headers: { authorization },
    });
    expect(authorized.status).toBe(200);
  });

  it("submits a ballot and returns authoritative results", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.choices["元颖斌"] = "opposition";
    draft.choices["邢辉"] = "opposition";

    const submitted = await app.request("/api/ballots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: "union-1", draft }),
    });
    expect(submitted.status).toBe(201);
    expect(await submitted.json()).toMatchObject({
      ballotNumber: "1-1",
      valid: true,
    });

    const response = await app.request("/api/results/union");
    expect(await response.json()).toMatchObject({
      activeBallots: 1,
      validBallots: 1,
    });

    const syncState = await app.request("/api/config");
    expect(await syncState.json()).toMatchObject({
      versions: { union: 2, expense: 1 },
      generations: { union: 1, expense: 1 },
    });
  });

  it("submits multiple identical ballots through the batch endpoint", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);
    const draft = createDefaultDraft("expense");
    draft.choices["李春君"] = "abstention";

    const submitted = await app.request("/api/ballots/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: "expense", draft, count: 3 }),
    });

    expect(submitted.status).toBe(201);
    expect(await submitted.json()).toMatchObject([
      { ballotNumber: "1", valid: true },
      { ballotNumber: "2", valid: true },
      { ballotNumber: "3", valid: true },
    ]);
    expect(repository.result("expense")).toMatchObject({
      activeBallots: 3,
      validBallots: 3,
    });
  });

  it("returns a recording progress snapshot for one group", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);
    const draft = createDefaultDraft("union");
    draft.manualInvalid = true;
    repository.submit("union-1", draft);
    repository.submit("union-2", draft);

    const response = await app.request("/api/recording-progress/union-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      groupId: "union-1",
      electionId: "union",
      groupActiveBallots: 1,
      electionActiveBallots: 2,
      electorLimit: 180,
    });
    expect((await app.request("/api/recording-progress/unknown")).status).toBe(
      404,
    );
  });

  it("hides a withdrawn record's former ballot number from history", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);
    const draft = createDefaultDraft("expense");
    const withdrawn = repository.submit("expense", draft);
    repository.withdraw("expense", withdrawn.id);
    expect(repository.submit("expense", draft).ballotNumber).toBe("1");

    const response = await app.request("/api/history/expense");
    const history = (await response.json()) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(history).toHaveLength(2);
    expect(history).toContainEqual(
      expect.objectContaining({
        id: withdrawn.id,
        ballotNumber: null,
        status: "withdrawn",
      }),
    );
    expect(history.every((record) => !("sequence" in record))).toBe(true);
  });

  it("does not expose the removed server-sent events endpoint", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);

    expect((await app.request("/api/events")).status).toBe(404);
  });

  it("rejects malformed ballot input as a client error", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);
    const response = await app.request("/api/ballots", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId: "union-1", draft: null }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a non-positive batch size as a client error", async () => {
    repository = createTallyRepository(":memory:");
    const app = createApp(repository);
    const response = await app.request("/api/ballots/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        groupId: "expense",
        draft: createDefaultDraft("expense"),
        count: 0,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "BAD_REQUEST" });
  });

  it("allows an administrator to update persisted elector limits", async () => {
    repository = createTallyRepository(":memory:");
    const salt = "test-salt";
    const hash = scryptSync("test-password", salt, 64).toString("hex");
    const app = createApp(repository, {
      adminPasswordHash: `${salt}:${hash}`,
    });

    const response = await app.request("/api/admin/elector-limits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        password: "test-password",
        electorLimits: { union: 175, expense: 168 },
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      electorLimits: { union: 175, expense: 168 },
    });
    expect(await (await app.request("/api/config")).json()).toMatchObject({
      elections: {
        union: { electorLimit: 175 },
        expense: { electorLimit: 168 },
      },
    });
  });
});
