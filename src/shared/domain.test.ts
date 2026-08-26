import { describe, expect, it } from "vitest";
import {
  ELECTIONS,
  createDefaultDraft,
  rankCandidates,
  validateDraft,
} from "./domain.js";

describe("ballot recording rules", () => {
  it("treats three oppositions on a union ballot as a valid 23-approval ballot", () => {
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.choices["元颖斌"] = "opposition";
    draft.choices["邢辉"] = "opposition";

    expect(validateDraft(draft)).toMatchObject({
      canSubmit: true,
      valid: true,
      approvals: 23,
    });
  });

  it("allows an expense-review overvote to be submitted only after confirmation", () => {
    const result = validateDraft(createDefaultDraft("expense"));
    expect(result).toMatchObject({
      canSubmit: true,
      valid: false,
      overvote: true,
      approvals: 8,
    });
  });

  it("rejects more write-ins than listed-candidate oppositions", () => {
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.writeIns = ["张三", "李四"];
    expect(validateDraft(draft)).toMatchObject({ canSubmit: false });
  });

  it("does not include write-ins when checking the listed-candidate approval limit", () => {
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.choices["元颖斌"] = "opposition";
    draft.choices["邢辉"] = "opposition";
    draft.writeIns = ["张三"];

    expect(validateDraft(draft)).toMatchObject({
      canSubmit: true,
      valid: true,
      overvote: false,
      approvals: 23,
    });
  });

  it("counts an empty write-in input as an occupied slot and requires a name", () => {
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.writeIns = [""];

    expect(validateDraft(draft)).toMatchObject({
      canSubmit: false,
      availableWriteIns: 0,
    });
    expect(validateDraft(draft).errors).toContain(
      "请填写另选人姓名或移除空白项",
    );
  });

  it("rejects duplicate and listed-candidate write-in names after trimming", () => {
    const draft = createDefaultDraft("union");
    draft.choices["王凯"] = "opposition";
    draft.choices["元颖斌"] = "opposition";
    draft.writeIns = [" 张三 ", "张三"];
    expect(validateDraft(draft).errors).toContain("另选人姓名不得重复：张三");
    draft.writeIns = ["王凯"];
    expect(validateDraft(draft).errors).toContain(
      "另选人不得与正式候选人同名：王凯",
    );
  });

  it("uses competition ranking and pinyin display order for exact ties", () => {
    expect(
      rankCandidates([
        {
          name: "周晓红",
          kind: "listed",
          approvals: 9,
          oppositions: 1,
          abstentions: 0,
        },
        {
          name: "李春君",
          kind: "listed",
          approvals: 10,
          oppositions: 2,
          abstentions: 0,
        },
        {
          name: "金岚",
          kind: "listed",
          approvals: 9,
          oppositions: 1,
          abstentions: 3,
        },
        {
          name: "孟佳宁",
          kind: "listed",
          approvals: 8,
          oppositions: 0,
          abstentions: 0,
        },
      ]),
    ).toEqual([
      {
        name: "李春君",
        kind: "listed",
        approvals: 10,
        oppositions: 2,
        abstentions: 0,
        rank: 1,
      },
      {
        name: "金岚",
        kind: "listed",
        approvals: 9,
        oppositions: 1,
        abstentions: 3,
        rank: 2,
      },
      {
        name: "周晓红",
        kind: "listed",
        approvals: 9,
        oppositions: 1,
        abstentions: 0,
        rank: 2,
      },
      {
        name: "孟佳宁",
        kind: "listed",
        approvals: 8,
        oppositions: 0,
        abstentions: 0,
        rank: 4,
      },
    ]);
  });

  it("keeps the fixed election configuration complete", () => {
    expect(ELECTIONS.union.candidates).toHaveLength(26);
    expect(ELECTIONS.expense.candidates).toHaveLength(8);
  });
});
