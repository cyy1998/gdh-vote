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
    expect(await submitted.json()).toMatchObject({ sequence: 1, valid: true });

    const response = await app.request("/api/results/union");
    expect(await response.json()).toMatchObject({
      activeBallots: 1,
      validBallots: 1,
    });
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
});
