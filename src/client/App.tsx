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
    const events = new EventSource("/api/events");
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
      <p>请选择本设备的录入组别。组别将固定可录入的选举类型。</p>
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
  const [message, setMessage] = useState("");
  const validation = useMemo(() => validateDraft(draft), [draft]);
  useEffect(() => {
    if (generation > 0)
      localStorage.setItem(
        `draft:${electionId}`,
        JSON.stringify({ generation, draft }),
      );
  }, [draft, electionId, generation]);
  const setChoice = (name: string, choice: Choice) =>
    setDraft((current) => ({
      ...current,
      choices: { ...current.choices, [name]: choice },
    }));
  const submit = async (manualInvalid = false) => {
    const next = { ...draft, manualInvalid };
    const checked = validateDraft(next);
    if (!checked.canSubmit) return setMessage(checked.errors.join("；"));
    if (
      (manualInvalid || checked.overvote) &&
      !confirm(
        manualInvalid
          ? "确认将本票记为人工无效票？无需填写原因，候选人票数不计入统计。"
          : `本票赞成 ${checked.approvals} 人，超过应选 ${election.seatCount} 人。确认作为无效票提交？`,
      )
    )
      return;
    try {
      const record = await api.submit(groupId, next);
      setMessage(`提交成功：服务器已分配第 ${record.sequence} 号选票`);
      const empty = createDefaultDraft(electionId);
      setDraft(empty);
      localStorage.setItem(
        `draft:${electionId}`,
        JSON.stringify({ generation, draft: empty }),
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">当前录入</span>
          <h2>{election.name}</h2>
        </div>
        <span>所有候选人默认“赞成”，只需修改纸票上的反对与弃权项。</span>
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
                setDraft((current) => ({
                  ...current,
                  writeIns: [...current.writeIns, ""],
                }))
              }
            >
              ＋ 添加另选人
            </button>
          </div>
          {validation.errors.length > 0 && (
            <div className="error">{validation.errors.join("；")}</div>
          )}
          {message && <div className="message">{message}</div>}
          <button
            className="primary"
            disabled={!validation.canSubmit}
            onClick={() => submit(false)}
          >
            提交本票
          </button>
          <button className="danger-outline" onClick={() => submit(true)}>
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
  const [error, setError] = useState("");
  const load = () =>
    api
      .history(groupId)
      .then(setRecords)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, [groupId, refresh]);
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
        <span>共 {records.length} 条历史记录</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="table">
        <div className="table-row table-head">
          <span>序号</span>
          <span>提交时间</span>
          <span>状态</span>
          <span>操作</span>
        </div>
        {records.map((record) => (
          <div key={record.id}>
            <div className="table-row">
              <strong>第 {record.sequence} 号</strong>
              <span>
                {new Date(record.submittedAt).toLocaleString("zh-CN")}
              </span>
              <span
                className={`badge ${record.status === "withdrawn" ? "muted" : record.valid ? "good" : "bad"}`}
              >
                {record.status === "withdrawn"
                  ? "已撤销"
                  : record.valid
                    ? "有效"
                    : "无效"}
              </span>
              <span>
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
            {expanded === record.id && (
              <div className="record-detail">
                <p>
                  {Object.entries(record.choices)
                    .map(
                      ([name, choice]) =>
                        `${name}：${choice === "approval" ? "赞成" : choice === "opposition" ? "反对" : "弃权"}`,
                    )
                    .join("　")}
                </p>
                <p>另选人：{record.writeIns.join("、") || "无"}</p>
              </div>
            )}
          </div>
        ))}
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
          <span className="eyebrow">所有设备实时可见</span>
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
          <p className="note">排名仅为计票结果，不代表系统自动宣布当选人。</p>
        </>
      )}
    </section>
  );
}

function Admin() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const reset = async (ids: ElectionId[], label: string) => {
    if (!password) return setMessage("请先输入管理员口令");
    if (
      !confirm(
        `确认${label}？此操作将永久删除记录、序号从 1 重新开始，且无法恢复。`,
      )
    )
      return;
    try {
      await api.reset(password, ids);
      setMessage(`${label}完成`);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
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
        <button onClick={() => reset(["union"], "清空工会委员会选举")}>
          清空工会委员会选举
        </button>
        <button onClick={() => reset(["expense"], "清空经费审查委员会选举")}>
          清空经费审查委员会选举
        </button>
        <button onClick={() => reset(["union", "expense"], "同时清空两项选举")}>
          同时清空两项选举
        </button>
      </div>
      {message && <div className="message">{message}</div>}
    </section>
  );
}
