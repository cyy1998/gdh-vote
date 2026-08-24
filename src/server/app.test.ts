import { afterEach, describe, expect, it } from "vitest";
import { createDefaultDraft } from "../shared/domain.js";
import { createApp } from "./app.js";
import { createTallyRepository, type TallyRepository } from "./repository.js";

let repository: TallyRepository | undefined;
afterEach(() => repository?.close());

describe("tally HTTP interface", () => {
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
