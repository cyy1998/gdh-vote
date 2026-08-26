import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ELECTIONS,
  RECORDING_GROUPS,
  createDefaultDraft,
  validateDraft,
  type BallotDraft,
  type Choice,
  type ElectionId,
  type RecordingGroupId,
} from "../shared/domain.js";
import {
  api,
  type BallotRecord,
  type RecordingProgress,
  type TallyResult,
} from "./api.js";

type Page = "entrance" | "record" | "history" | "results" | "admin";
type HistorySortOrder = "asc" | "desc";
const groupOrder: RecordingGroupId[] = [
  "union-1",
  "union-2",
  "union-3",
  "expense",
];

export function App() {
  const [groupId, setGroupId] = useState<RecordingGroupId | null>(
    () => sessionStorage.getItem("recordingGroup") as RecordingGroupId | null,
  );
  const [page, setPage] = useState<Page>(groupId ? "record" : "entrance");
  const [resultElection, setResultElection] = useState<ElectionId>(
    groupId ? RECORDING_GROUPS[groupId].electionId : "union",
  );
  const [connected, setConnected] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const versions = useRef<Record<ElectionId, number> | undefined>(undefined);
  const [generations, setGenerations] = useState<Record<ElectionId, number>>({
    union: 0,
    expense: 0,
  });

  useEffect(() => {
    let active = true;
    let timeout: number | undefined;
    const poll = async () => {
      try {
        const state = await api.syncState();
        if (!active) return;
        const previous = versions.current;
        versions.current = state.versions;
        setGenerations(state.generations);
        setConnected(true);
        if (
          previous === undefined ||
          previous.union !== state.versions.union ||
          previous.expense !== state.versions.expense
        ) {
          setRefresh((value) => value + 1);
        }
      } catch {
        if (active) setConnected(false);
      } finally {
        if (active) timeout = window.setTimeout(() => void poll(), 2_000);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, []);

  const selectGroup = (id: RecordingGroupId) => {
    sessionStorage.setItem("recordingGroup", id);
    setGroupId(id);
    setResultElection(RECORDING_GROUPS[id].electionId);
    setPage("record");
  };
  const switchGroup = () => {
    sessionStorage.removeItem("recordingGroup");
    setGroupId(null);
  };

  if (!groupId && page !== "results")
    return (
      <Entrance onSelect={selectGroup} onResults={() => setPage("results")} />
    );
  if (!groupId && page === "results")
    return (
      <>
        <Entrance onSelect={selectGroup} onResults={() => undefined} />
        <div className="public-results">
          <Results
            electionId={resultElection}
            setElectionId={setResultElection}
            refresh={refresh}
          />
        </div>
      </>
    );

  return (
    <div className="app-shell">
      <header>
        <div>
          <span className="eyebrow">上海燃气有限公司工会委员会</span>
          <h1>第二届“两委”委员选举计票系统</h1>
        </div>
        <div className="header-status">
          <span className={connected ? "online" : "offline"}>
            {connected ? "服务器已连接" : "正在重连"}
          </span>
          <strong>{RECORDING_GROUPS[groupId!].name}</strong>
          <span>{ELECTIONS[RECORDING_GROUPS[groupId!].electionId].name}</span>
          <button className="link" onClick={switchGroup}>
            切换组别
          </button>
        </div>
      </header>
      <nav>
        {(["record", "history", "results"] as Page[]).map((item) => (
          <button
            className={page === item ? "active" : ""}
            onClick={() => setPage(item)}
            key={item}
          >
            {item === "record"
              ? "选票录入"
              : item === "history"
                ? "录入历史"
                : "实时结果"}
          </button>
        ))}
        <button
          className={page === "admin" ? "active" : ""}
          onClick={() => setPage("admin")}
        >
          管理
        </button>
      </nav>
      <main>
        {page === "record" && (
          <Recorder
            key={`${RECORDING_GROUPS[groupId!].electionId}:${generations[RECORDING_GROUPS[groupId!].electionId]}`}
            groupId={groupId!}
            generation={generations[RECORDING_GROUPS[groupId!].electionId]}
            refresh={refresh}
          />
        )}
        {page === "history" && <History groupId={groupId!} refresh={refresh} />}
        {page === "results" && (
          <Results
            electionId={resultElection}
            setElectionId={setResultElection}
            refresh={refresh}
          />
        )}
        {page === "admin" && <Admin />}
      </main>
    </div>
  );
}

function Entrance({
  onSelect,
  onResults,
}: {
  onSelect: (id: RecordingGroupId) => void;
  onResults: () => void;
}) {
  return (
    <section className="entrance">
      <span className="eyebrow">上海燃气有限公司工会委员会</span>
      <h1>
        第二届“两委”委员选举
        <br />
        计票系统
      </h1>
      <p>请选择本设备的录入组别。</p>
      <div className="group-section">
        <h2>工会委员会委员选举</h2>
        <div className="group-grid">
          {groupOrder.slice(0, 3).map((id) => (
            <button onClick={() => onSelect(id)} key={id}>
              <strong>{RECORDING_GROUPS[id].name}</strong>
              <span>录入工会委员会选票</span>
            </button>
          ))}
        </div>
      </div>
      <div className="group-section">
        <h2>经费审查委员会委员选举</h2>
        <div className="group-grid single">
          <button onClick={() => onSelect("expense")}>
            <strong>经审组</strong>
            <span>录入经费审查委员会选票</span>
          </button>
        </div>
      </div>
      <button className="results-link" onClick={onResults}>
        直接查看实时结果 →
      </button>
    </section>
  );
}

function loadDraft(electionId: ElectionId, generation: number) {
  try {
    const value = localStorage.getItem(`draft:${electionId}`);
    if (!value) return createDefaultDraft(electionId);
    const saved = JSON.parse(value) as {
      generation: number;
      draft: BallotDraft;
    };
    return saved.generation === generation
      ? saved.draft
      : createDefaultDraft(electionId);
  } catch {
    return createDefaultDraft(electionId);
  }
}

function Recorder({
  groupId,
  generation,
  refresh,
}: {
  groupId: RecordingGroupId;
  generation: number;
  refresh: number;
}) {
  const electionId = RECORDING_GROUPS[groupId].electionId;
  const election = ELECTIONS[electionId];
  const [draft, setDraft] = useState(() => loadDraft(electionId, generation));
  const [errorMessage, setErrorMessage] = useState("");
  const [progress, setProgress] = useState<RecordingProgress | null>(null);
  const [progressError, setProgressError] = useState(false);
  const progressRequest = useRef(0);
  const [submissionNotice, setSubmissionNotice] = useState<{
    sequence: number;
    valid: boolean;
  } | null>(null);
  const [pendingSubmission, setPendingSubmission] = useState<{
    draft: BallotDraft;
    kind: "manual" | "overvote";
    approvals: number;
  } | null>(null);
  const validation = useMemo(() => validateDraft(draft), [draft]);
  const atElectorLimit =
    progress !== null &&
    progress.electionActiveBallots >= progress.electorLimit;
  const loadProgress = useCallback(async () => {
    const request = ++progressRequest.current;
    try {
      const next = await api.recordingProgress(groupId);
      if (request !== progressRequest.current) return;
      setProgress(next);
      setProgressError(false);
      if (next.electionActiveBallots < next.electorLimit)
        setErrorMessage((current) =>
          current.startsWith("已达到") ? "" : current,
        );
    } catch {
      if (request === progressRequest.current) setProgressError(true);
    }
  }, [groupId]);
  useEffect(() => {
    setProgress(null);
    setProgressError(false);
  }, [groupId]);
  useEffect(() => {
    void loadProgress();
    return () => {
      progressRequest.current += 1;
    };
  }, [loadProgress, refresh]);
  useEffect(() => {
    if (generation > 0)
      localStorage.setItem(
        `draft:${electionId}`,
        JSON.stringify({ generation, draft }),
      );
  }, [draft, electionId, generation]);
  useEffect(() => {
    if (submissionNotice === null) return;
    const timeout = window.setTimeout(() => setSubmissionNotice(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [submissionNotice]);
  useEffect(() => {
    if (atElectorLimit) setPendingSubmission(null);
  }, [atElectorLimit]);
  const setChoice = (name: string, choice: Choice) =>
    setDraft((current) => ({
      ...current,
      choices: { ...current.choices, [name]: choice },
    }));
  const resetDraft = () => {
    const empty = createDefaultDraft(electionId);
    setDraft(empty);
    setErrorMessage("");
    localStorage.setItem(
      `draft:${electionId}`,
      JSON.stringify({ generation, draft: empty }),
    );
  };
  const performSubmission = async (next: BallotDraft) => {
    try {
      const record = await api.submit(groupId, next);
      setErrorMessage("");
      setSubmissionNotice({ sequence: record.sequence, valid: record.valid });
      const empty = createDefaultDraft(electionId);
      setDraft(empty);
      localStorage.setItem(
        `draft:${electionId}`,
        JSON.stringify({ generation, draft: empty }),
      );
      void loadProgress();
    } catch (error) {
      setSubmissionNotice(null);
      setErrorMessage((error as Error).message);
      void loadProgress();
    }
  };
  const requestSubmission = (manualInvalid = false) => {
    if (atElectorLimit) {
      setErrorMessage("已达到投票人数上限");
      return;
    }
    const next = { ...draft, manualInvalid };
    const checked = validateDraft(next);
    if (!checked.canSubmit) return setErrorMessage(checked.errors.join("；"));
    if (manualInvalid || checked.overvote) {
      setPendingSubmission({
        draft: next,
        kind: manualInvalid ? "manual" : "overvote",
        approvals: checked.approvals,
      });
      return;
    }
    void performSubmission(next);
  };
  useEffect(() => {
    const submitWithSpace = (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        pendingSubmission !== null
      )
        return;

      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return;

      event.preventDefault();
      requestSubmission(false);
    };

    window.addEventListener("keydown", submitWithSpace);
    return () => window.removeEventListener("keydown", submitWithSpace);
  });
  return (
    <>
      {submissionNotice !== null && (
        <div
          className={`submit-toast ${submissionNotice.valid ? "" : "invalid"}`}
          role="status"
          aria-live="assertive"
        >
          <span className="submit-toast-icon" aria-hidden="true">
            ✓
          </span>
          <strong className="submit-toast-copy">
            第 {submissionNotice.sequence} 号
            {submissionNotice.valid ? "选票" : "无效票"}录入成功
          </strong>
          <button
            type="button"
            aria-label="关闭录入提示"
            onClick={() => setSubmissionNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {pendingSubmission !== null && (
        <div className="confirm-overlay">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invalid-confirm-title"
          >
            <span className="confirm-dialog-mark" aria-hidden="true">
              !
            </span>
            <h3 id="invalid-confirm-title">
              {pendingSubmission.kind === "manual"
                ? "确认记为无效票？"
                : "确认提交超额无效票？"}
            </h3>
            <p>
              {pendingSubmission.kind === "manual"
                ? "本票只计入无效票总数，不计入任何候选人票数。"
                : `本票赞成 ${pendingSubmission.approvals} 人，超过应选 ${election.seatCount} 人，将作为无效票计入。`}
            </p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-cancel"
                autoFocus
                onClick={() => setPendingSubmission(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="confirm-danger"
                disabled={atElectorLimit}
                onClick={() => {
                  const next = pendingSubmission.draft;
                  setPendingSubmission(null);
                  void performSubmission(next);
                }}
              >
                确认记为无效票
              </button>
            </div>
          </section>
        </div>
      )}
      <div className="page-heading">
        <div>
          <span className="eyebrow">当前录入</span>
          <h2>{election.name}</h2>
        </div>
        <button type="button" className="reset-draft" onClick={resetDraft}>
          重置本票
        </button>
      </div>
      <div className="progress-mobile">
        <RecordingProgressCard
          progress={progress}
          refreshFailed={progressError}
        />
      </div>
      <div className="record-layout">
        <section className="candidate-panel">
          <div className="candidate-head">
            <span>正式候选人（按选票顺序）</span>
            <span>赞成 / 反对 / 弃权</span>
          </div>
          <div className="candidate-grid">
            {election.candidates.map((name, index) => (
              <div
                className={`candidate-row ${draft.choices[name]}`}
                key={name}
              >
                <b>{String(index + 1).padStart(2, "0")}</b>
                <strong>{name}</strong>
                <div className="segmented">
                  {(["approval", "opposition", "abstention"] as Choice[]).map(
                    (choice) => (
                      <button
                        className={
                          draft.choices[name] === choice ? "selected" : ""
                        }
                        onClick={() => setChoice(name, choice)}
                        key={choice}
                      >
                        {choice === "approval"
                          ? "赞成"
                          : choice === "opposition"
                            ? "反对"
                            : "弃权"}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
        <aside className="summary">
          <div className="progress-desktop">
            <RecordingProgressCard
              progress={progress}
              refreshFailed={progressError}
              testIds
            />
          </div>
          <div className="ballot-summary">
            <h3>本票汇总</h3>
            <div className="counts">
              <div>
                <b>{validation.approvals}</b>
                <span>赞成</span>
              </div>
              <div>
                <b>{validation.oppositions}</b>
                <span>反对</span>
              </div>
              <div>
                <b>{validation.abstentions}</b>
                <span>弃权</span>
              </div>
              <div>
                <b>{draft.writeIns.filter((x) => x.trim()).length}</b>
                <span>另选</span>
              </div>
            </div>
            <div
              className={`validity ${validation.valid ? "valid" : "invalid"}`}
            >
              <strong>
                {validation.valid
                  ? "当前为有效票"
                  : validation.overvote
                    ? "当前为超额无效票"
                    : draft.manualInvalid
                      ? "当前为人工无效票"
                      : "需要修正"}
              </strong>
              <span>
                应选 {election.seatCount} 人 · 赞成合计 {validation.approvals}{" "}
                人
              </span>
            </div>
            <div className="write-ins">
              <div>
                <h3>另选人</h3>
                <span>可用名额 {validation.availableWriteIns}</span>
              </div>
              {draft.writeIns.map((name, index) => (
                <div className="write-row" key={index}>
                  <input
                    value={name}
                    placeholder="输入姓名"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        writeIns: current.writeIns.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      }))
                    }
                  />
                  <button
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        writeIns: current.writeIns.filter(
                          (_, i) => i !== index,
                        ),
                      }))
                    }
                  >
                    移除
                  </button>
                </div>
              ))}
              <button
                className="secondary"
                disabled={validation.availableWriteIns <= 0}
                onClick={() =>
                  setDraft((current) =>
                    validateDraft(current).availableWriteIns <= 0
                      ? current
                      : {
                          ...current,
                          writeIns: [...current.writeIns, ""],
                        },
                  )
                }
              >
                ＋ 添加另选人
              </button>
            </div>
            {validation.errors.length > 0 && (
              <div className="error">{validation.errors.join("；")}</div>
            )}
            {errorMessage && <div className="error">{errorMessage}</div>}
            <button
              className="primary"
              disabled={!validation.canSubmit || atElectorLimit}
              title="快捷键：空格"
              onClick={() => requestSubmission(false)}
            >
              提交本票
            </button>
            <button
              className="danger-outline"
              disabled={atElectorLimit}
              onClick={() => requestSubmission(true)}
            >
              记为无效票
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

function RecordingProgressCard({
  progress,
  refreshFailed,
  testIds = false,
}: {
  progress: RecordingProgress | null;
  refreshFailed: boolean;
  testIds?: boolean;
}) {
  const atLimit =
    progress !== null &&
    progress.electionActiveBallots >= progress.electorLimit;
  return (
    <section
      className={`recording-progress ${atLimit ? "at-limit" : ""}`}
      aria-label="录入进度"
      aria-live="polite"
    >
      <h3>录入进度</h3>
      <dl>
        <div>
          <dt>本组已录入</dt>
          <dd>
            <strong data-testid={testIds ? "group-recording-count" : undefined}>
              {progress?.groupActiveBallots ?? "—"}
            </strong>{" "}
            张
          </dd>
        </div>
        <div>
          <dt>本选举已录入</dt>
          <dd>
            <strong
              data-testid={testIds ? "election-recording-count" : undefined}
            >
              {progress?.electionActiveBallots ?? "—"}
            </strong>{" "}
            /{" "}
            <span data-testid={testIds ? "elector-limit" : undefined}>
              {progress?.electorLimit ?? "—"}
            </span>{" "}
            张
          </dd>
        </div>
      </dl>
      <p className="progress-caption">已录入 / 上限</p>
      {atLimit && (
        <p className="progress-limit-message">
          <strong>已达到投票人数上限</strong>
          <span>撤销记录后可继续录入</span>
        </p>
      )}
      {refreshFailed && (
        <p className="progress-error">
          {progress ? "进度更新失败，显示上次数据" : "进度更新失败，可继续录入"}
        </p>
      )}
      {!progress && !refreshFailed && (
        <p className="progress-loading">正在获取录入进度…</p>
      )}
    </section>
  );
}

function History({
  groupId,
  refresh,
}: {
  groupId: RecordingGroupId;
  refresh: number;
}) {
  const [records, setRecords] = useState<BallotRecord[]>([]);
  const [expanded, setExpanded] = useState<number>();
  const [sortOrder, setSortOrder] = useState<HistorySortOrder>("desc");
  const [error, setError] = useState("");
  const [pendingWithdrawal, setPendingWithdrawal] =
    useState<BallotRecord | null>(null);
  const load = () =>
    api
      .history(groupId)
      .then(setRecords)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [groupId, refresh]);
  const sortedRecords = useMemo(
    () =>
      [...records].sort((first, second) => {
        const comparison =
          first.submittedAt.localeCompare(second.submittedAt) ||
          first.sequence - second.sequence;
        return sortOrder === "asc" ? comparison : -comparison;
      }),
    [records, sortOrder],
  );
  const withdraw = async (record: BallotRecord) => {
    setPendingWithdrawal(null);
    try {
      await api.withdraw(groupId, record.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      {pendingWithdrawal !== null && (
        <div className="confirm-overlay">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-confirm-title"
          >
            <span className="confirm-dialog-mark" aria-hidden="true">
              !
            </span>
            <h3 id="withdraw-confirm-title">
              确认撤销第 {pendingWithdrawal.sequence} 号记录？
            </h3>
            <p>原记录将保留在录入历史中，并标记为已撤销。</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-cancel"
                autoFocus
                onClick={() => setPendingWithdrawal(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="confirm-danger"
                onClick={() => void withdraw(pendingWithdrawal)}
              >
                确认撤销
              </button>
            </div>
          </section>
        </div>
      )}
      <section>
        <div className="page-heading">
          <div>
            <span className="eyebrow">{RECORDING_GROUPS[groupId].name}</span>
            <h2>录入历史</h2>
          </div>
          <div className="history-controls">
            <span>共 {records.length} 条历史记录</span>
            <label>
              提交时间
              <select
                aria-label="提交时间排序"
                value={sortOrder}
                onChange={(event) =>
                  setSortOrder(event.target.value as HistorySortOrder)
                }
              >
                <option value="desc">最新在前</option>
                <option value="asc">最早在前</option>
              </select>
            </label>
          </div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="table" role="table" aria-label="录入历史">
          <div className="table-row table-head" role="row">
            <span role="columnheader">序号</span>
            <span role="columnheader">提交时间</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">操作</span>
          </div>
          {sortedRecords.map((record) => (
            <div key={record.id}>
              <div className="table-row" role="row">
                <strong role="cell">第 {record.sequence} 号</strong>
                <span role="cell">
                  {new Date(record.submittedAt).toLocaleString("zh-CN")}
                </span>
                <span
                  role="cell"
                  className={`badge ${record.status === "withdrawn" ? "muted" : record.valid ? "good" : "bad"}`}
                >
                  {record.status === "withdrawn"
                    ? "已撤销"
                    : record.valid
                      ? "有效"
                      : "无效"}
                </span>
                <span role="cell">
                  <button
                    className="link"
                    onClick={() =>
                      setExpanded(
                        expanded === record.id ? undefined : record.id,
                      )
                    }
                  >
                    {expanded === record.id ? "收起" : "查看票面"}
                  </button>
                  {record.status === "active" && (
                    <button
                      className="link danger-text"
                      onClick={() => setPendingWithdrawal(record)}
                    >
                      撤销
                    </button>
                  )}
                </span>
              </div>
              {expanded === record.id && <BallotSheet record={record} />}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const choicePresentation: Record<Choice, { label: string; symbol: string }> = {
  approval: { label: "赞成", symbol: "○" },
  opposition: { label: "反对", symbol: "×" },
  abstention: { label: "弃权", symbol: "—" },
};

function BallotChoiceGrid({
  label,
  candidates,
  choices,
}: {
  label: string;
  candidates: readonly string[];
  choices: Record<string, Choice>;
}) {
  return (
    <div className="ballot-grid-scroller">
      <div
        className="ballot-sheet-grid"
        role="list"
        aria-label={label}
        style={{
          gridTemplateColumns: `56px repeat(${candidates.length}, 48px)`,
        }}
      >
        <div className="ballot-sheet-labels" aria-hidden="true">
          <span>符号</span>
          <strong>候选人姓名</strong>
        </div>
        {candidates.map((name) => {
          const choice = choices[name];
          const presentation = choicePresentation[choice];
          return (
            <div
              className={`ballot-sheet-candidate ${choice}`}
              role="listitem"
              aria-label={`${name}：${presentation.label}`}
              key={name}
            >
              <span className="ballot-sheet-symbol" aria-hidden="true">
                {presentation.symbol}
              </span>
              <strong className="ballot-sheet-name" aria-hidden="true">
                {name}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BallotSheet({ record }: { record: BallotRecord }) {
  const election = ELECTIONS[record.electionId];
  const writeInChoices = Object.fromEntries(
    record.writeIns.map((name) => [name, "approval" as const]),
  );
  return (
    <section
      className="record-detail ballot-sheet"
      role="region"
      aria-label={`第 ${record.sequence} 号选票票面`}
    >
      <div className="ballot-sheet-heading">
        <div>
          <span className="eyebrow">选票票面</span>
          <h3>
            第 {record.sequence} 号 · {election.shortName}
          </h3>
        </div>
        <div className="ballot-sheet-legend" aria-label="票面符号说明">
          <span>○ 赞成</span>
          <span>× 反对</span>
          <span>— 弃权</span>
        </div>
      </div>
      <BallotChoiceGrid
        label="正式候选人票面"
        candidates={election.candidates}
        choices={record.choices}
      />
      <div className="write-in-sheet">
        <strong>另选人</strong>
        {record.writeIns.length > 0 ? (
          <BallotChoiceGrid
            label="另选人票面"
            candidates={record.writeIns}
            choices={writeInChoices}
          />
        ) : (
          <span className="no-write-ins">无另选人</span>
        )}
      </div>
    </section>
  );
}

function Results({
  electionId,
  setElectionId,
  refresh,
}: {
  electionId: ElectionId;
  setElectionId: (id: ElectionId) => void;
  refresh: number;
}) {
  const [result, setResult] = useState<TallyResult>();
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .result(electionId)
      .then(setResult)
      .catch((e) => setError(e.message));
  }, [electionId, refresh]);
  return (
    <section>
      <div className="page-heading">
        <div>
          <h2>实时结果</h2>
        </div>
        <div className="tabs">
          <button
            className={electionId === "union" ? "active" : ""}
            onClick={() => setElectionId("union")}
          >
            工会委员会
          </button>
          <button
            className={electionId === "expense" ? "active" : ""}
            onClick={() => setElectionId("expense")}
          >
            经费审查委员会
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <>
          <div className="result-counts">
            <div>
              <span>已录入总数</span>
              <b>{result.activeBallots}</b>
            </div>
            <div>
              <span>有效票</span>
              <b>{result.validBallots}</b>
            </div>
            <div>
              <span>无效票</span>
              <b>{result.invalidBallots}</b>
            </div>
          </div>
          <div className="result-table">
            <div className="result-row table-head">
              <span>名次</span>
              <span>候选人</span>
              <span>类型</span>
              <span>赞成票</span>
              <span>反对票</span>
              <span>弃权票</span>
            </div>
            {result.candidates.map((candidate) => (
              <div
                className="result-row"
                key={`${candidate.kind}-${candidate.name}`}
              >
                <strong>{candidate.rank}</strong>
                <b>{candidate.name}</b>
                <span>{candidate.kind === "listed" ? "正式" : "另选"}</span>
                <strong>{candidate.approvals}</strong>
                <span>{candidate.oppositions}</span>
                <span>{candidate.abstentions}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Admin() {
  const [password, setPassword] = useState("");
  const [electorLimits, setElectorLimits] = useState<
    Record<ElectionId, string>
  >({ union: "", expense: "" });
  const [pendingReset, setPendingReset] = useState<{
    ids: ElectionId[];
    label: string;
  } | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  useEffect(() => {
    api
      .syncState()
      .then((state) =>
        setElectorLimits({
          union: String(state.electorLimits.union),
          expense: String(state.electorLimits.expense),
        }),
      )
      .catch((e) => setNotice({ kind: "error", text: (e as Error).message }));
  }, []);
  useEffect(() => {
    if (notice === null) return;
    const timeout = window.setTimeout(() => setNotice(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const requestReset = (ids: ElectionId[], label: string) => {
    if (!password) {
      setNotice({ kind: "error", text: "请先输入管理员口令" });
      return;
    }
    setPendingReset({ ids, label });
  };
  const reset = async (ids: ElectionId[], label: string) => {
    try {
      await api.reset(password, ids);
      setPassword("");
      setNotice({ kind: "success", text: `${label}成功` });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  };
  const saveElectorLimits = async () => {
    if (!password) {
      setNotice({ kind: "error", text: "请先输入管理员口令" });
      return;
    }
    const limits = {
      union: Number(electorLimits.union),
      expense: Number(electorLimits.expense),
    };
    if (
      !Number.isInteger(limits.union) ||
      limits.union <= 0 ||
      !Number.isInteger(limits.expense) ||
      limits.expense <= 0
    ) {
      setNotice({ kind: "error", text: "投票人数上限必须是正整数" });
      return;
    }
    try {
      const state = await api.updateElectorLimits(password, limits);
      setElectorLimits({
        union: String(state.electorLimits.union),
        expense: String(state.electorLimits.expense),
      });
      setPassword("");
      setNotice({ kind: "success", text: "投票人数上限保存成功" });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    }
  };
  return (
    <>
      {notice !== null && (
        <div
          className={`submit-toast ${notice.kind === "error" ? "invalid" : ""}`}
          role="status"
          aria-live="assertive"
        >
          <span className="submit-toast-icon" aria-hidden="true">
            {notice.kind === "success" ? "✓" : "!"}
          </span>
          <strong className="submit-toast-copy">{notice.text}</strong>
          <button
            type="button"
            aria-label="关闭操作提示"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}
      {pendingReset !== null && (
        <div className="confirm-overlay">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-reset-confirm-title"
          >
            <span className="confirm-dialog-mark" aria-hidden="true">
              !
            </span>
            <h3 id="admin-reset-confirm-title">确认{pendingReset.label}？</h3>
            <p>此操作将永久删除全部相关记录，序号从 1 重新开始，且无法恢复。</p>
            <div className="confirm-dialog-actions">
              <button
                type="button"
                className="confirm-cancel"
                autoFocus
                onClick={() => setPendingReset(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="confirm-danger"
                onClick={() => {
                  const { ids, label } = pendingReset;
                  setPendingReset(null);
                  void reset(ids, label);
                }}
              >
                确认清空
              </button>
            </div>
          </section>
        </div>
      )}
      <section className="admin">
        <div className="page-heading">
          <div>
            <span className="eyebrow">仅限管理员</span>
            <h2>系统管理</h2>
          </div>
        </div>
        <label>
          管理员口令
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="admin-section">
          <h3>投票人数上限</h3>
          <p className="note">分别设置两项选举允许录入的未撤销选票数量。</p>
          <div className="limit-grid">
            <label>
              工会委员会选举
              <input
                type="number"
                min="1"
                step="1"
                value={electorLimits.union}
                onChange={(e) =>
                  setElectorLimits((current) => ({
                    ...current,
                    union: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              经费审查委员会选举
              <input
                type="number"
                min="1"
                step="1"
                value={electorLimits.expense}
                onChange={(e) =>
                  setElectorLimits((current) => ({
                    ...current,
                    expense: e.target.value,
                  }))
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="primary admin-save"
            disabled={!electorLimits.union || !electorLimits.expense}
            onClick={() => void saveElectorLimits()}
          >
            保存投票人数上限
          </button>
        </div>
        <div className="admin-section">
          <h3>计票清空</h3>
          <div className="warning">
            清空会永久删除目标选举的全部记录并重置序号，不提供备份与恢复。
          </div>
          <div className="danger-actions">
            <button
              onClick={() => requestReset(["union"], "清空工会委员会选举")}
            >
              清空工会委员会选举
            </button>
            <button
              onClick={() =>
                requestReset(["expense"], "清空经费审查委员会选举")
              }
            >
              清空经费审查委员会选举
            </button>
            <button
              onClick={() =>
                requestReset(["union", "expense"], "同时清空两项选举")
              }
            >
              同时清空两项选举
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
