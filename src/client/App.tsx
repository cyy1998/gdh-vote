import { useEffect, useMemo, useState } from "react";
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
import { api, type BallotRecord, type TallyResult } from "./api.js";

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
  const [generations, setGenerations] = useState<Record<ElectionId, number>>({
    union: 0,
    expense: 0,
  });

  useEffect(() => {
    const events = new EventSource(api.eventsUrl);
    events.addEventListener("version", (event) => {
      const state = JSON.parse((event as MessageEvent).data) as {
        generations: Record<ElectionId, number>;
      };
      setGenerations(state.generations);
      setConnected(true);
      setRefresh((value) => value + 1);
    });
    events.onerror = () => setConnected(false);
    return () => events.close();
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
          <span className="eyebrow">上海燃气有限公司工会</span>
          <h1>第二届“两委”委员选举计票助手</h1>
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
      <div className="seal">票</div>
      <span className="eyebrow">上海燃气有限公司工会</span>
      <h1>
        第二届“两委”委员选举
        <br />
        计票助手
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
}: {
  groupId: RecordingGroupId;
  generation: number;
}) {
  const electionId = RECORDING_GROUPS[groupId].electionId;
  const election = ELECTIONS[electionId];
  const [draft, setDraft] = useState(() => loadDraft(electionId, generation));
  const [errorMessage, setErrorMessage] = useState("");
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
    } catch (error) {
      setSubmissionNotice(null);
      setErrorMessage((error as Error).message);
    }
  };
  const requestSubmission = (manualInvalid = false) => {
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
          <div className={`validity ${validation.valid ? "valid" : "invalid"}`}>
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
              应选 {election.seatCount} 人 · 赞成合计 {validation.approvals} 人
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
                      writeIns: current.writeIns.filter((_, i) => i !== index),
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
            disabled={!validation.canSubmit}
            onClick={() => requestSubmission(false)}
          >
            提交本票
          </button>
          <button
            className="danger-outline"
            onClick={() => requestSubmission(true)}
          >
            记为无效票
          </button>
        </aside>
      </div>
    </>
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
    if (
      !confirm(`确认撤销第 ${record.sequence} 号记录？原记录会保留在历史中。`)
    )
      return;
    try {
      await api.withdraw(groupId, record.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
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
                    setExpanded(expanded === record.id ? undefined : record.id)
                  }
                >
                  {expanded === record.id ? "收起" : "查看票面"}
                </button>
                {record.status === "active" && (
                  <button
                    className="link danger-text"
                    onClick={() => withdraw(record)}
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
  const [pendingReset, setPendingReset] = useState<{
    ids: ElectionId[];
    label: string;
  } | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
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
            <h2>计票清空</h2>
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
        <div className="warning">
          清空会永久删除目标选举的全部记录并重置序号，不提供备份与恢复。
        </div>
        <div className="danger-actions">
          <button onClick={() => requestReset(["union"], "清空工会委员会选举")}>
            清空工会委员会选举
          </button>
          <button
            onClick={() => requestReset(["expense"], "清空经费审查委员会选举")}
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
      </section>
    </>
  );
}
