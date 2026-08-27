import type {
  BallotDraft,
  BallotNumber,
  ElectionId,
  RecordingGroupId,
  RankedCandidate,
} from "../shared/domain.js";

export interface BallotRecord {
  id: number;
  ballotNumber: BallotNumber | null;
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

export interface SyncState {
  versions: Record<ElectionId, number>;
  generations: Record<ElectionId, number>;
  electorLimits: Record<ElectionId, number>;
}

export interface RecordingProgress {
  groupId: RecordingGroupId;
  electionId: ElectionId;
  version: number;
  groupActiveBallots: number;
  electionActiveBallots: number;
  electorLimit: number;
}

const API_BASE = `${import.meta.env.BASE_URL}api`;

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
  syncState: () => request<SyncState>(`${API_BASE}/config`),
  result: (electionId: ElectionId) =>
    request<TallyResult>(`${API_BASE}/results/${electionId}`),
  history: (groupId: RecordingGroupId) =>
    request<BallotRecord[]>(`${API_BASE}/history/${groupId}`),
  recordingProgress: (groupId: RecordingGroupId) =>
    request<RecordingProgress>(`${API_BASE}/recording-progress/${groupId}`),
  submit: (groupId: RecordingGroupId, draft: BallotDraft) =>
    request<BallotRecord>(`${API_BASE}/ballots`, {
      method: "POST",
      body: JSON.stringify({ groupId, draft }),
    }),
  withdraw: (groupId: RecordingGroupId, id: number) =>
    request<{ ok: true }>(`${API_BASE}/ballots/${id}/withdraw`, {
      method: "POST",
      body: JSON.stringify({ groupId }),
    }),
  reset: (password: string, electionIds: ElectionId[]) =>
    request<{ ok: true }>(`${API_BASE}/admin/reset`, {
      method: "POST",
      body: JSON.stringify({ password, electionIds }),
    }),
  updateElectorLimits: (
    password: string,
    electorLimits: Record<ElectionId, number>,
  ) =>
    request<{ ok: true } & SyncState>(`${API_BASE}/admin/elector-limits`, {
      method: "POST",
      body: JSON.stringify({ password, electorLimits }),
    }),
};
