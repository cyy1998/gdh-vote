import type {
  BallotDraft,
  ElectionId,
  RecordingGroupId,
  RankedCandidate,
} from "../shared/domain.js";

export interface BallotRecord {
  id: number;
  sequence: number;
  electionId: ElectionId;
  groupId: RecordingGroupId;
  status: "active" | "withdrawn";
  valid: boolean;
  manualInvalid: boolean;
  submittedAt: string;
  withdrawnAt: string | null;
  choices: BallotDraft["choices"];
  writeIns: string[];
}

export interface TallyResult {
  electionId: ElectionId;
  version: number;
  activeBallots: number;
  validBallots: number;
  invalidBallots: number;
  candidates: RankedCandidate[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "请求失败");
  return body;
}

export const api = {
  result: (electionId: ElectionId) =>
    request<TallyResult>(`/api/results/${electionId}`),
  history: (groupId: RecordingGroupId) =>
    request<BallotRecord[]>(`/api/history/${groupId}`),
  submit: (groupId: RecordingGroupId, draft: BallotDraft) =>
    request<BallotRecord>("/api/ballots", {
      method: "POST",
      body: JSON.stringify({ groupId, draft }),
    }),
  withdraw: (groupId: RecordingGroupId, id: number) =>
    request<{ ok: true }>(`/api/ballots/${id}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ groupId }),
    }),
  reset: (password: string, electionIds: ElectionId[]) =>
    request<{ ok: true }>("/api/admin/reset", {
      method: "POST",
      body: JSON.stringify({ password, electionIds }),
    }),
};
