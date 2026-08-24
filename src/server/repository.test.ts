import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
    draft.choices["邢辉"] = "opposition";

    const submitted = repository.submit("union-1", draft);

    expect(submitted).toMatchObject({
      sequence: 1,
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
    ).toMatchObject({ approvals: 0, oppositions: 1 });
  });

  it("withdraws without reusing a sequence and reset restarts from one", () => {
    const repository = createRepository();
    const draft = createDefaultDraft("expense");
    const initialGeneration = repository.syncState().generations.expense;
    const first = repository.submit("expense", draft);
    expect(repository.syncState().generations.expense).toBe(initialGeneration);
    repository.withdraw("expense", first.id);
    expect(repository.result("expense")).toMatchObject({ activeBallots: 0 });
    expect(repository.submit("expense", draft).sequence).toBe(2);
    repository.reset(["expense"]);
    expect(repository.syncState().generations.expense).toBe(
      initialGeneration + 1,
    );
    expect(repository.submit("expense", draft).sequence).toBe(1);
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
            candidate.approvals === 0 && candidate.oppositions === 0,
        ),
    ).toBe(true);
    expect(repository.result("union")).toMatchObject({
      activeBallots: 1,
      validBallots: 0,
      invalidBallots: 1,
    });
  });

  it("enforces the 180 active-ballot limit and allows another ballot after withdrawal", () => {
    const repository = createRepository();
    const draft = createDefaultDraft("expense");
    const records = Array.from({ length: 180 }, () =>
      repository.submit("expense", draft),
    );
    expect(records.at(-1)?.sequence).toBe(180);
    expect(() => repository.submit("expense", draft)).toThrow(
      "已达到 180 张未撤销选票上限",
    );
    repository.withdraw("expense", records[0].id);
    expect(repository.submit("expense", draft).sequence).toBe(181);
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
      firstSession.close();

      const restarted = createTallyRepository(filename);
      expect(restarted.history("expense").map((item) => item.status)).toEqual([
        "active",
        "withdrawn",
      ]);
      expect(restarted.result("expense")).toMatchObject({ activeBallots: 1 });
      restarted.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
