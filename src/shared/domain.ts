import { pinyin } from "pinyin-pro";

export type ElectionId = "union" | "expense";
export type RecordingGroupId = "union-1" | "union-2" | "union-3" | "expense";
export type Choice = "approval" | "opposition" | "abstention";

export interface ElectionConfig {
  id: ElectionId;
  name: string;
  shortName: string;
  seatCount: number;
  electorLimit: number;
  candidates: readonly string[];
  groups: readonly RecordingGroupId[];
}

export const ELECTIONS: Record<ElectionId, ElectionConfig> = {
  union: {
    id: "union",
    name: "工会委员会委员选举",
    shortName: "工会委员会",
    seatCount: 23,
    electorLimit: 180,
    groups: ["union-1", "union-2", "union-3"],
    candidates: [
      "王凯",
      "元颖斌",
      "邢辉",
      "回申强",
      "朱川红",
      "朱阳",
      "许亮",
      "孙黎",
      "苏建国",
      "李斌",
      "吴莹",
      "汪致宏",
      "张畅敏",
      "张忠华",
      "陈杰",
      "陈晓斌",
      "金一冰",
      "金风保",
      "周杰",
      "姚亮",
      "倪旭辉",
      "徐洁",
      "徐晓慧",
      "黄立群",
      "雷雯",
      "虞珊君",
    ],
  },
  expense: {
    id: "expense",
    name: "经费审查委员会委员选举",
    shortName: "经费审查委员会",
    seatCount: 7,
    electorLimit: 180,
    groups: ["expense"],
    candidates: [
      "李春君",
      "金岚",
      "周晓红",
      "孟佳宁",
      "赵芳芳",
      "秦文炎",
      "原瑜",
      "程旸",
    ],
  },
};

export const RECORDING_GROUPS: Record<
  RecordingGroupId,
  { name: string; electionId: ElectionId }
> = {
  "union-1": { name: "工会第一组", electionId: "union" },
  "union-2": { name: "工会第二组", electionId: "union" },
  "union-3": { name: "工会第三组", electionId: "union" },
  expense: { name: "经审组", electionId: "expense" },
};

export interface BallotDraft {
  electionId: ElectionId;
  choices: Record<string, Choice>;
  writeIns: string[];
  manualInvalid: boolean;
}

export interface DraftValidation {
  canSubmit: boolean;
  valid: boolean;
  overvote: boolean;
  approvals: number;
  oppositions: number;
  abstentions: number;
  availableWriteIns: number;
  normalizedWriteIns: string[];
  errors: string[];
}

export function createDefaultDraft(electionId: ElectionId): BallotDraft {
  return {
    electionId,
    choices: Object.fromEntries(
      ELECTIONS[electionId].candidates.map((name) => [name, "approval"]),
    ),
    writeIns: [],
    manualInvalid: false,
  };
}

export function validateDraft(draft: BallotDraft): DraftValidation {
  const election = ELECTIONS[draft.electionId];
  const errors: string[] = [];
  const normalizedWriteIns = draft.writeIns
    .map((name) => name.trim())
    .filter(Boolean);
  const choiceValues = election.candidates.map((name) => draft.choices[name]);
  if (
    choiceValues.some(
      (choice) => !["approval", "opposition", "abstention"].includes(choice),
    )
  ) {
    errors.push("每名正式候选人必须选择赞成、反对或弃权");
  }
  const oppositions = choiceValues.filter(
    (choice) => choice === "opposition",
  ).length;
  const abstentions = choiceValues.filter(
    (choice) => choice === "abstention",
  ).length;
  const listedApprovals = choiceValues.filter(
    (choice) => choice === "approval",
  ).length;
  if (normalizedWriteIns.length > oppositions)
    errors.push(`另选人数不能超过反对数（当前最多 ${oppositions} 人）`);
  const duplicate = normalizedWriteIns.find(
    (name, index) => normalizedWriteIns.indexOf(name) !== index,
  );
  if (duplicate) errors.push(`另选人姓名不得重复：${duplicate}`);
  const listed = normalizedWriteIns.find((name) =>
    election.candidates.includes(name),
  );
  if (listed) errors.push(`另选人不得与正式候选人同名：${listed}`);
  const approvals = listedApprovals + normalizedWriteIns.length;
  const overvote = approvals > election.seatCount;
  return {
    canSubmit: errors.length === 0,
    valid: errors.length === 0 && !draft.manualInvalid && !overvote,
    overvote,
    approvals,
    oppositions,
    abstentions,
    availableWriteIns: Math.max(0, oppositions - normalizedWriteIns.length),
    normalizedWriteIns,
    errors,
  };
}

export interface CandidateTotal {
  name: string;
  kind: "listed" | "write-in";
  approvals: number;
  oppositions: number;
}

export type RankedCandidate = CandidateTotal & { rank: number };

export function rankCandidates(
  candidates: CandidateTotal[],
): RankedCandidate[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      b.approvals - a.approvals ||
      a.oppositions - b.oppositions ||
      pinyin(a.name, { toneType: "none", type: "array" })
        .join(" ")
        .localeCompare(
          pinyin(b.name, { toneType: "none", type: "array" }).join(" "),
          "en",
        ),
  );
  return sorted.reduce<RankedCandidate[]>((ranked, candidate, index) => {
    const previous = ranked[index - 1];
    ranked.push({
      ...candidate,
      rank:
        previous &&
        candidate.approvals === previous.approvals &&
        candidate.oppositions === previous.oppositions
          ? previous.rank
          : index + 1,
    });
    return ranked;
  }, []);
}
