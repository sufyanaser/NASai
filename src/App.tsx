import { useEffect, useState } from "react";

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="icon" aria-hidden="true">
    {children}
  </span>
);

type NavTab = "Workspace" | "Tasks" | "Evidence" | "Knowledge";

const navItems: Array<{ label: NavTab; icon: string }> = [
  { label: "Workspace", icon: "⌘" },
  { label: "Tasks", icon: "◇" },
  { label: "Evidence", icon: "◎" },
  { label: "Knowledge", icon: "▤" },
];

type AgentState =
  | "idle"
  | "thinking"
  | "working"
  | "verifying"
  | "success"
  | "attention";

const reactions: Record<
  AgentState,
  { image: string; label: string; message: string }
> = {
  idle: {
    image: "./brand/nasai-mascot.png",
    label: "Ready",
    message: "Ready when you are.",
  },
  thinking: {
    image: "./brand/nasai-thinking.png",
    label: "Thinking",
    message: "I’m mapping the safest path.",
  },
  working: {
    image: "./brand/nasai-working.png",
    label: "Inspecting",
    message: "I’m inspecting the selected workspace.",
  },
  verifying: {
    image: "./brand/nasai-thinking.png",
    label: "Verifying",
    message: "Checking the evidence before I call it done.",
  },
  success: {
    image: "./brand/nasai-success.png",
    label: "Verified",
    message: "Done — the checks passed.",
  },
  attention: {
    image: "./brand/nasai-attention.png",
    label: "Needs you",
    message: "I found something that needs your attention.",
  },
};

const suggestionText: Record<string, string> = {
  "Review a change":
    "Review the latest changes and report only evidence-backed findings.",
  "Diagnose a failure":
    "Diagnose the current failure, identify the root cause, and show the evidence.",
  "Plan a feature":
    "Plan the smallest testable version of this feature without scope creep.",
};

function stateBadgeClass(state: GateState) {
  return `evidence-state ${state.toLowerCase().replace(" ", "-")}`;
}

export function App() {
  const [activeTab, setActiveTab] = useState<NavTab>("Workspace");
  const [update, setUpdate] = useState<UpdateStatus>({
    state: "idle",
    message: "Updates ready",
  });
  const [version, setVersion] = useState("0.2.0");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [task, setTask] = useState("");
  const [lastTask, setLastTask] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [taskEvidence, setTaskEvidence] = useState<TaskEvidence | null>(null);
  const [taskHistory, setTaskHistory] = useState<TaskEvidence[]>([]);
  const [proposals, setProposals] = useState<ProposedAction[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    description: string;
    reason: string;
    proposedContent: string;
  }>({ description: "", reason: "", proposedContent: "" });

  const pendingSensitiveCount = proposals.filter(
    (p) => p.requiresApproval && p.status === "pending_approval",
  ).length;

  const reaction =
    !workspace && agentState === "idle"
      ? {
          ...reactions.idle,
          label: "Waiting",
          message: "Choose a workspace to begin.",
        }
      : pendingSensitiveCount > 0 && agentState === "attention"
        ? {
            ...reactions.attention,
            label: "Needs you",
            message:
              "Review and approve each sensitive action individually before execution.",
          }
        : reactions[agentState];
  const isRunning = ["thinking", "working", "verifying"].includes(agentState);

  useEffect(() => {
    void window.nasai?.getAppInfo().then((info) => setVersion(info.version));
    void window.nasai?.getWorkspace().then(setWorkspace);
    void window.nasai?.listTasks?.().then((items) => {
      if (items && items.length > 0) {
        setTaskHistory(items);
        setTaskEvidence(items[0]);
        setProposals(items[0].proposals ?? []);
        setLastTask(items[0].prompt);
      }
    });
    const removeUpdateListener = window.nasai?.onUpdateStatus(setUpdate);
    const removeTaskListener = window.nasai?.onTaskStatus(setAgentState);
    return () => {
      removeUpdateListener?.();
      removeTaskListener?.();
    };
  }, []);

  const applyTaskRecord = (record: TaskEvidence) => {
    const nextProposals = record.proposals ?? [];
    setTaskEvidence(record);
    setProposals(nextProposals);
    setLastTask(record.prompt);
    setTaskHistory((prev) => [
      record,
      ...prev.filter((item) => item.id !== record.id),
    ]);
  };

  const checkUpdates = () => void window.nasai?.checkForUpdates();

  const runTask = async () => {
    if (!task.trim() || isRunning) return;
    if (!window.nasai || !workspace) {
      setAgentState("attention");
      return;
    }
    try {
      setAgentState("thinking");
      const evidence = await window.nasai.runTask(task);
      const nextProposals = evidence.proposals ?? [];
      applyTaskRecord(evidence);
      const hasPendingApproval = nextProposals.some(
        (p) => p.requiresApproval && p.status === "pending_approval",
      );
      setAgentState(
        hasPendingApproval
          ? "attention"
          : evidence.status === "PASS"
            ? "success"
            : "attention",
      );
    } catch {
      setAgentState("attention");
    }
  };

  const handleDecision = async (
    actionId: string,
    decision: "approve" | "reject",
  ) => {
    if (!window.nasai?.decideProposal) return;
    const updated = await window.nasai.decideProposal({
      actionId,
      decision,
      scope: "single_action",
    });
    const next = proposals.map((p) => (p.id === actionId ? updated : p));
    setProposals(next);
    if (taskEvidence) {
      setTaskEvidence({ ...taskEvidence, proposals: next });
    }
    const stillWaiting = next.some(
      (p) => p.requiresApproval && p.status === "pending_approval",
    );
    setAgentState(
      stillWaiting
        ? "attention"
        : decision === "approve"
          ? "success"
          : "idle",
    );
  };

  const handleExecuteApproved = async (actionId: string) => {
    if (!window.nasai?.executeProposal) return;
    const updatedTask = await window.nasai.executeProposal(actionId);
    applyTaskRecord(updatedTask);
    setAgentState(updatedTask.status === "PASS" ? "success" : "attention");
  };

  const handleRollbackLast = async () => {
    if (!window.nasai?.rollbackLastCheckpoint) return;
    const updatedTask = await window.nasai.rollbackLastCheckpoint();
    applyTaskRecord(updatedTask);
    setAgentState("success");
  };

  const handleRunFixtureCycle = async () => {
    if (!window.nasai?.runSafeEditFixtureCycle) return;
    setAgentState("working");
    const cycleTask = await window.nasai.runSafeEditFixtureCycle();
    applyTaskRecord(cycleTask);
    setAgentState(cycleTask.status === "PASS" ? "success" : "attention");
  };

  const startEditingProposal = (proposal: ProposedAction) => {
    setEditingId(proposal.id);
    setEditDraft({
      description: proposal.description,
      reason: proposal.reason,
      proposedContent: proposal.proposedContent ?? "",
    });
  };

  const saveProposalEdit = async (actionId: string) => {
    if (!window.nasai?.editProposal) return;
    const updated = await window.nasai.editProposal(actionId, {
      description: editDraft.description,
      reason: editDraft.reason,
      proposedContent: editDraft.proposedContent,
    });
    const next = proposals.map((p) => (p.id === actionId ? updated : p));
    setProposals(next);
    if (taskEvidence) {
      setTaskEvidence({ ...taskEvidence, proposals: next });
    }
    setEditingId(null);
    setAgentState("attention");
  };

  const selectWorkspace = async () => {
    const selected = await window.nasai?.selectWorkspace();
    if (!selected) return;
    setWorkspace(selected);
    setAgentState("idle");
    setTaskEvidence(null);
    setProposals([]);
    setEditingId(null);
    setLastTask(null);
  };

  const checks = workspace
    ? [
        ["Workspace scope", workspace.name],
        [
          "Project rules",
          workspace.rules.length > 0
            ? `${workspace.rules.length} loaded`
            : "Not found",
        ],
        [
          "Git state",
          workspace.gitAvailable
            ? `${workspace.branch ?? "detached"}${workspace.dirty ? " · changed" : " · clean"}`
            : "Not detected",
        ],
      ]
    : [
        ["Workspace scope", "Choose a folder"],
        ["Project rules", "Not inspected"],
        ["Git state", "Not inspected"],
      ];

  const acknowledgeMascot = () => {
    if (isRunning) return;
    if (agentState !== "idle") setAgentState("idle");
  };

  const activeCheckpoints = (taskEvidence?.checkpoints ?? []).filter(
    (chk) => chk.rolledBackAt === null,
  );

  const renderProposalsSection = () =>
    proposals.length > 0 && (
      <section className="proposals-section" aria-label="Proposed actions">
        <div className="proposals-header">
          <div>
            <span className="eyebrow">APPROVAL GATE</span>
            <h4>
              Proposed actions ({pendingSensitiveCount} awaiting approval)
            </h4>
          </div>
          <span className="approval-policy-badge">
            Single-action approval only · Blanket approvals disabled
          </span>
        </div>
        <div className="proposals-list">
          {proposals.map((proposal) => (
            <article
              className={`proposal-card risk-${proposal.riskLevel}`}
              key={proposal.id}
            >
              <div className="proposal-meta">
                <span className={`risk-badge risk-${proposal.riskLevel}`}>
                  ▲ RISK: {proposal.riskLevel.toUpperCase()}
                </span>
                <span className="proposal-kind">{proposal.kind}</span>
                <span className={`proposal-status status-${proposal.status}`}>
                  {proposal.status.replaceAll("_", " ").toUpperCase()}
                </span>
              </div>
              <div className="proposal-body">
                <strong>{proposal.description}</strong>
                <p className="proposal-reason">{proposal.reason}</p>
                <div className="proposal-target">
                  <span>Affected target:</span> <code>{proposal.target}</code>
                </div>
                {proposal.sensitiveReason && (
                  <small className="sensitive-reason">
                    Sensitive action: {proposal.sensitiveReason}
                  </small>
                )}
              </div>
              {editingId === proposal.id ? (
                <div
                  className="proposal-editor"
                  aria-label="Edit proposal form"
                >
                  <label>
                    Description
                    <input
                      type="text"
                      aria-label="Proposal description"
                      value={editDraft.description}
                      onChange={(e) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      type="text"
                      aria-label="Proposal reason"
                      value={editDraft.reason}
                      onChange={(e) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          reason: e.target.value,
                        }))
                      }
                    />
                  </label>
                  {(proposal.kind === "create_file" ||
                    proposal.kind === "edit_file") && (
                    <label>
                      Proposed content
                      <textarea
                        aria-label="Proposed content"
                        value={editDraft.proposedContent}
                        onChange={(e) =>
                          setEditDraft((prev) => ({
                            ...prev,
                            proposedContent: e.target.value,
                          }))
                        }
                      />
                    </label>
                  )}
                  <div className="proposal-actions">
                    <button
                      className="approve-button"
                      type="button"
                      onClick={() => void saveProposalEdit(proposal.id)}
                    >
                      Save proposal edits
                    </button>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel edit
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <pre
                    className="proposal-diff"
                    aria-label={`Preview for ${proposal.target}`}
                  >
                    {proposal.preview}
                  </pre>
                  <small className="proposal-recovery">
                    Recovery: {proposal.recovery.description}
                  </small>
                  {proposal.evidence && (
                    <div className="proposal-evidence-line">
                      <span className={stateBadgeClass(proposal.evidence.state)}>
                        {proposal.evidence.state}
                      </span>
                      <small>{proposal.evidence.summary}</small>
                    </div>
                  )}
                  {proposal.status === "pending_approval" && (
                    <div className="proposal-actions">
                      <button
                        className="approve-button"
                        type="button"
                        onClick={() =>
                          void handleDecision(proposal.id, "approve")
                        }
                      >
                        Approve single action
                      </button>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => startEditingProposal(proposal)}
                      >
                        Edit proposal
                      </button>
                      <button
                        className="reject-button"
                        type="button"
                        onClick={() =>
                          void handleDecision(proposal.id, "reject")
                        }
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {proposal.status === "approved" &&
                    window.nasai?.executeProposal && (
                      <div className="proposal-actions">
                        <button
                          className="approve-button"
                          type="button"
                          onClick={() =>
                            void handleExecuteApproved(proposal.id)
                          }
                        >
                          Execute approved action
                        </button>
                      </div>
                    )}
                </>
              )}
            </article>
          ))}
        </div>
      </section>
    );

  return (
    <main className="application-frame">
      <header className="window-bar">
        <div className="window-drag-region">
          <img src="./brand/nasai-mark-mono.svg" alt="" />
          <span>NASai</span>
          <span className="window-context">
            {workspace?.name ?? "Workspace"}
          </span>
        </div>
        <div className="window-controls" aria-label="Window controls">
          <button
            type="button"
            aria-label="Minimize window"
            onClick={() => window.nasai?.minimizeWindow()}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Maximize window"
            onClick={() => window.nasai?.toggleMaximizeWindow()}
          >
            □
          </button>
          <button
            className="window-close"
            type="button"
            aria-label="Close window"
            onClick={() => window.nasai?.closeWindow()}
          >
            ×
          </button>
        </div>
      </header>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">
              <img src="./brand/nasai-mark-mono.svg" alt="" />
            </span>
            <span>
              NAS<span className="brand-accent">ai</span>
            </span>
          </div>
          <nav aria-label="Main navigation">
            {navItems.map((item) => (
              <button
                className={`nav-item ${activeTab === item.label ? "active" : ""}`}
                key={item.label}
                type="button"
                onClick={() => setActiveTab(item.label)}
              >
                <Icon>{item.icon}</Icon>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div className="safety-card">
              <span className="pulse" />
              <div>
                <strong>Safe mode</strong>
                <small>Approvals required</small>
              </div>
            </div>
            <button className="profile" type="button">
              <span>SN</span>
              <div>
                <strong>Sufyan</strong>
                <small>Local workspace</small>
              </div>
              <b>•••</b>
            </button>
          </div>
        </aside>

        <section className="workspace">
          <header className="topbar">
            <div>
              <span className="eyebrow">CURRENT WORKSPACE</span>
              <h1>
                {workspace
                  ? `${workspace.name} · ${workspace.fileCount} files inspected`
                  : "Choose a workspace to begin."}
              </h1>
            </div>
            <div className="top-actions">
              <span className="connection">
                <i /> Local
              </span>
              <button
                className="ghost-button"
                type="button"
                onClick={() => void selectWorkspace()}
              >
                {workspace ? "Change workspace" : "Open workspace"}
              </button>
            </div>
          </header>

          {activeTab === "Workspace" && (
            <div className="content-grid">
              <div className="content-main">
                <section className="hero-card">
                  <div className="hero-intro">
                    <div className="hero-copy">
                      <span className={`status-pill state-${agentState}`}>
                        {reaction.label}
                      </span>
                      <h2>What should we investigate?</h2>
                      <p>
                        Describe a focused task. NASai will inspect the selected
                        workspace, load project rules, and capture evidence
                        without changing project files.
                      </p>
                    </div>
                    <button
                      className={`mascot-stage state-${agentState}`}
                      type="button"
                      onClick={acknowledgeMascot}
                      aria-label={`NASai status: ${reaction.label}. ${reaction.message}`}
                    >
                      <span className="mascot-halo" />
                      <img key={reaction.image} src={reaction.image} alt="" />
                      <span className="mascot-status">{reaction.label}</span>
                      <span className="mascot-message">{reaction.message}</span>
                    </button>
                  </div>
                  <div className="prompt-box">
                    <textarea
                      aria-label="Task description"
                      placeholder="Example: Audit the update flow and fix only verified failures…"
                      value={task}
                      onChange={(event) => {
                        setTask(event.target.value);
                        if (!isRunning) setAgentState("idle");
                      }}
                      disabled={isRunning}
                    />
                    <div className="prompt-actions">
                      <button
                        className="attach"
                        type="button"
                        aria-label="Attach context"
                      >
                        ＋
                      </button>
                      <span className="workspace-scope">
                        {workspace
                          ? `Scope: ${workspace.path}`
                          : "Choose a workspace before starting"}
                      </span>
                      <button
                        className="run-button"
                        type="button"
                        onClick={() => void runTask()}
                        disabled={!task.trim() || isRunning || !workspace}
                      >
                        {isRunning ? reaction.label : "Start task"}{" "}
                        <b>{isRunning ? "•••" : "↗"}</b>
                      </button>
                    </div>
                  </div>
                  <div className="suggestions">
                    {Object.keys(suggestionText).map((label) => (
                      <button
                        type="button"
                        key={label}
                        onClick={() => setTask(suggestionText[label])}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="activity-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">RECENT ACTIVITY</span>
                      <h3>{lastTask ? "Task verified" : "Nothing to recover"}</h3>
                    </div>
                    <span className="muted">Today</span>
                  </div>
                  <div className={`empty-state ${lastTask ? "has-task" : ""}`}>
                    <span>◇</span>
                    <div>
                      <strong>
                        {lastTask ?? "Your verified tasks will appear here"}
                      </strong>
                      <p>
                        {lastTask
                          ? (taskEvidence?.summary ??
                            "Evidence is ready for review.")
                          : "Each task keeps its decisions, commands, gate results, and evidence together."}
                      </p>
                    </div>
                  </div>
                  {taskEvidence && (
                    <div className="evidence-list" aria-label="Task evidence">
                      {taskEvidence.checks.map((check) => (
                        <div key={check.label}>
                          <span className={stateBadgeClass(check.state)}>
                            {check.state}
                          </span>
                          <strong>{check.label}</strong>
                          <small>{check.detail}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  {renderProposalsSection()}
                </section>
              </div>

              <aside className="context-sidebar" aria-label="Context sidebar">
                <div className="readiness-card">
                  <div className="card-heading">
                    <div>
                      <span className="eyebrow">PREFLIGHT</span>
                      <h3>Workspace readiness</h3>
                    </div>
                    <span className="score">
                      {workspace ? "3 checks" : "0/3"}
                    </span>
                  </div>
                  <div className="checks">
                    {checks.map(([name, state]) => (
                      <div className="check" key={name}>
                        <span className="checkmark">{workspace ? "✓" : "·"}</span>
                        <div>
                          <strong>{name}</strong>
                          <small>{state}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    className="review-link"
                    type="button"
                    onClick={() => setActiveTab("Knowledge")}
                  >
                    Review operating charter <span>→</span>
                  </button>
                </div>

                <div className="update-card">
                  <div>
                    <span className={`update-orb ${update.state}`}>
                      <i />
                    </span>
                    <div>
                      <strong>NASai {version}</strong>
                      <small>{update.message}</small>
                    </div>
                  </div>
                  {update.state === "downloaded" ? (
                    <button
                      type="button"
                      onClick={() => void window.nasai?.installUpdate()}
                    >
                      Restart & install
                    </button>
                  ) : (
                    <button type="button" onClick={checkUpdates}>
                      Check
                    </button>
                  )}
                </div>
              </aside>
            </div>
          )}

          {activeTab === "Tasks" && (
            <section className="ledger-screen" aria-label="Tasks view">
              <div className="ledger-card">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">TASK LEDGER & STAGES</span>
                    <h2>
                      {taskEvidence
                        ? taskEvidence.prompt
                        : "No active task recorded yet"}
                    </h2>
                  </div>
                  <div className="ledger-header-actions">
                    {taskEvidence && (
                      <span className={stateBadgeClass(taskEvidence.status)}>
                        {taskEvidence.status}
                      </span>
                    )}
                    {window.nasai?.runSafeEditFixtureCycle && (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => void handleRunFixtureCycle()}
                      >
                        Run isolated safe-edit cycle
                      </button>
                    )}
                  </div>
                </div>

                {taskEvidence ? (
                  <div className="ledger-sections">
                    <div className="timing-bar" aria-label="Task timing">
                      <span>Started: {taskEvidence.startedAt}</span>
                      <span>Completed: {taskEvidence.completedAt}</span>
                      <span>
                        Duration: {taskEvidence.durationMs ?? 0}ms
                      </span>
                      <span>Workspace: {taskEvidence.workspace}</span>
                    </div>

                    <div className="ledger-block" aria-label="Task stages">
                      <span className="eyebrow">STAGES</span>
                      <div className="stages-grid">
                        {(taskEvidence.stages ?? []).map((stage) => (
                          <div className="stage-row" key={stage.id}>
                            <span className={stateBadgeClass(stage.state)}>
                              {stage.state}
                            </span>
                            <div>
                              <strong>{stage.label}</strong>
                              <small>{stage.detail}</small>
                            </div>
                            <time>{stage.timestamp}</time>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ledger-block" aria-label="Approval summary">
                      <span className="eyebrow">APPROVAL DECISIONS</span>
                      <div className="stages-grid">
                        {proposals.length === 0 ? (
                          <small className="muted">
                            No proposals recorded for this task.
                          </small>
                        ) : (
                          proposals.map((prop) => (
                            <div className="stage-row" key={prop.id}>
                              <span
                                className={`proposal-status status-${prop.status}`}
                              >
                                {prop.status.replaceAll("_", " ").toUpperCase()}
                              </span>
                              <div>
                                <strong>
                                  {prop.description} ({prop.target})
                                </strong>
                                <small>
                                  Risk: {prop.riskLevel.toUpperCase()} ·{" "}
                                  {prop.requiresApproval
                                    ? "Requires explicit single-action approval"
                                    : "Read-only"}
                                </small>
                              </div>
                              <time>{prop.updatedAt}</time>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {renderProposalsSection()}

                    {taskHistory.length > 1 && (
                      <div className="ledger-block" aria-label="Task history">
                        <span className="eyebrow">
                          RECENT TASK HISTORY ({taskHistory.length}/50)
                        </span>
                        <div className="stages-grid">
                          {taskHistory.map((item) => (
                            <button
                              className="history-item-btn"
                              key={item.id}
                              type="button"
                              onClick={() => applyTaskRecord(item)}
                            >
                              <span className={stateBadgeClass(item.status)}>
                                {item.status}
                              </span>
                              <strong>{item.prompt}</strong>
                              <small>{item.completedAt}</small>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="muted">
                    Start a task in the Workspace tab or run the isolated
                    safe-edit fixture cycle to inspect stages, proposals, and
                    approvals.
                  </p>
                )}
              </div>
            </section>
          )}

          {activeTab === "Evidence" && (
            <section className="ledger-screen" aria-label="Evidence view">
              <div className="ledger-card">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">
                      INSPECTABLE EVIDENCE & RECOVERY LEDGER
                    </span>
                    <h2>
                      {taskEvidence
                        ? `Verification status: ${taskEvidence.status}`
                        : "No verification evidence recorded yet"}
                    </h2>
                  </div>
                  <div className="ledger-header-actions">
                    {taskEvidence && (
                      <span className={stateBadgeClass(taskEvidence.status)}>
                        {taskEvidence.status}
                      </span>
                    )}
                    {activeCheckpoints.length > 0 && (
                      <button
                        className="reject-button"
                        type="button"
                        onClick={() => void handleRollbackLast()}
                      >
                        Rollback last action
                      </button>
                    )}
                  </div>
                </div>

                {taskEvidence ? (
                  <div className="ledger-sections">
                    <div className="timing-bar" aria-label="Evidence timing">
                      <span>Task ID: {taskEvidence.id}</span>
                      <span>Started: {taskEvidence.startedAt}</span>
                      <span>Completed: {taskEvidence.completedAt}</span>
                      <span>Duration: {taskEvidence.durationMs ?? 0}ms</span>
                    </div>

                    <div
                      className="ledger-block"
                      aria-label="Verification gate results"
                    >
                      <span className="eyebrow">
                        TEST & GATE RESULTS ({taskEvidence.checks.length})
                      </span>
                      <div className="evidence-list">
                        {taskEvidence.checks.map((check) => (
                          <div key={check.label}>
                            <span className={stateBadgeClass(check.state)}>
                              {check.state}
                            </span>
                            <strong>{check.label}</strong>
                            <small>{check.detail}</small>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="ledger-block" aria-label="Git evidence">
                      <span className="eyebrow">GIT STATE</span>
                      <div className="stage-row">
                        <span
                          className={stateBadgeClass(
                            taskEvidence.gitState?.gitAvailable
                              ? "PASS"
                              : "NOT VERIFIED",
                          )}
                        >
                          {taskEvidence.gitState?.gitAvailable
                            ? "PASS"
                            : "NOT VERIFIED"}
                        </span>
                        <div>
                          <strong>
                            {taskEvidence.gitState?.gitAvailable
                              ? `Branch: ${taskEvidence.gitState.branch ?? "detached HEAD"} · ${taskEvidence.gitState.dirty ? "Dirty (uncommitted changes present)" : "Clean"}`
                              : "Git repository not detected"}
                          </strong>
                          <small>
                            {(taskEvidence.gitState?.porcelainLines ?? [])
                              .length > 0
                              ? taskEvidence.gitState!.porcelainLines.join(
                                  " | ",
                                )
                              : "No uncommitted porcelain entries"}
                          </small>
                        </div>
                      </div>
                    </div>

                    <div
                      className="ledger-block"
                      aria-label="Executed commands"
                    >
                      <span className="eyebrow">
                        EXECUTED COMMANDS (
                        {(taskEvidence.commands ?? []).length})
                      </span>
                      {(taskEvidence.commands ?? []).length === 0 ? (
                        <small className="muted">
                          No commands executed for this task.
                        </small>
                      ) : (
                        <div className="stages-grid">
                          {(taskEvidence.commands ?? []).map((cmd) => (
                            <div className="command-evidence-card" key={cmd.actionId}>
                              <div className="stage-row">
                                <span className={stateBadgeClass(cmd.state)}>
                                  {cmd.state}
                                </span>
                                <div>
                                  <strong>
                                    {cmd.executable} {cmd.args.join(" ")}
                                  </strong>
                                  <small>
                                    Exit code: {cmd.exitCode ?? "null"} ·{" "}
                                    {cmd.durationMs}ms · cwd: {cmd.cwd}
                                  </small>
                                </div>
                              </div>
                              {(cmd.stdout || cmd.stderr) && (
                                <pre className="proposal-diff">
                                  {cmd.stdout}
                                  {cmd.stderr}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="ledger-block" aria-label="Modified files">
                      <span className="eyebrow">
                        MODIFIED FILES (
                        {(taskEvidence.modifiedFiles ?? []).length})
                      </span>
                      {(taskEvidence.modifiedFiles ?? []).length === 0 ? (
                        <small className="muted">
                          No workspace files were modified.
                        </small>
                      ) : (
                        <div className="stages-grid">
                          {(taskEvidence.modifiedFiles ?? []).map((file) => (
                            <div
                              className="stage-row"
                              key={`${file.checkpointId}-${file.relativePath}`}
                            >
                              <span
                                className={stateBadgeClass(
                                  file.rolledBack ? "PASS" : "PASS",
                                )}
                              >
                                {file.rolledBack ? "ROLLED BACK" : file.kind}
                              </span>
                              <div>
                                <strong>{file.relativePath}</strong>
                                <small>
                                  Before SHA-256:{" "}
                                  {file.beforeHash?.slice(0, 12) ?? "none"} →
                                  After SHA-256:{" "}
                                  {file.afterHash?.slice(0, 12) ?? "deleted"}
                                </small>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div
                      className="ledger-block"
                      aria-label="Recovery checkpoints"
                    >
                      <span className="eyebrow">
                        RECOVERY CHECKPOINTS (
                        {(taskEvidence.checkpoints ?? []).length})
                      </span>
                      {(taskEvidence.checkpoints ?? []).length === 0 ? (
                        <small className="muted">
                          No file-write checkpoints created yet.
                        </small>
                      ) : (
                        <div className="stages-grid">
                          {(taskEvidence.checkpoints ?? []).map((chk) => (
                            <div className="stage-row" key={chk.id}>
                              <span
                                className={stateBadgeClass(
                                  chk.rollbackVerification,
                                )}
                              >
                                {chk.rollbackVerification}
                              </span>
                              <div>
                                <strong>
                                  {chk.id} · {chk.relativePath} ({chk.kind})
                                </strong>
                                <small>
                                  {chk.rollbackDetail ??
                                    `Backup stored outside workspace · Pre-change hash: ${chk.beforeHash?.slice(0, 12) ?? "none"}`}
                                </small>
                              </div>
                              <time>{chk.rolledBackAt ?? chk.createdAt}</time>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="muted">
                    No evidence ledger active yet. Run a task or trigger the
                    isolated safe-edit cycle to inspect verification checks,
                    commands, modified files, and checkpoints.
                  </p>
                )}
              </div>
            </section>
          )}

          {activeTab === "Knowledge" && (
            <section className="ledger-screen" aria-label="Knowledge view">
              <div className="ledger-card">
                <div className="card-heading">
                  <div>
                    <span className="eyebrow">CANONICAL POLICY SET</span>
                    <h2>Loaded rules & safety charter</h2>
                  </div>
                  <span className="approval-policy-badge">
                    contextIsolation · sandbox · single-action approvals
                  </span>
                </div>
                <div className="ledger-sections">
                  <div className="ledger-block">
                    <span className="eyebrow">LOADED WORKSPACE RULES</span>
                    <div className="stages-grid">
                      {(workspace?.rules ?? []).length === 0 ? (
                        <small className="muted">
                          No rule files loaded yet.
                        </small>
                      ) : (
                        workspace!.rules.map((rule) => (
                          <div className="stage-row" key={rule}>
                            <span className={stateBadgeClass("PASS")}>
                              PASS
                            </span>
                            <div>
                              <strong>{rule}</strong>
                              <small>
                                Active rule file enforced inside{" "}
                                {workspace!.path}
                              </small>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          <footer>
            <span>Evidence-first agent shell</span>
            <span>Local-first · Human approval · Recoverable changes</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
