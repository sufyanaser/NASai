import { useEffect, useState } from "react";

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="icon" aria-hidden="true">
    {children}
  </span>
);

const navItems = [
  { label: "Workspace", icon: "⌘", active: true },
  { label: "Tasks", icon: "◇" },
  { label: "Evidence", icon: "◎" },
  { label: "Knowledge", icon: "▤" },
];

type AgentState =
  "idle" | "thinking" | "working" | "verifying" | "success" | "attention";

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

export function App() {
  const [update, setUpdate] = useState<UpdateStatus>({
    state: "idle",
    message: "Updates ready",
  });
  const [version, setVersion] = useState("0.1.0");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [task, setTask] = useState("");
  const [lastTask, setLastTask] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [taskEvidence, setTaskEvidence] = useState<TaskEvidence | null>(null);
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
    const removeUpdateListener = window.nasai?.onUpdateStatus(setUpdate);
    const removeTaskListener = window.nasai?.onTaskStatus(setAgentState);
    return () => {
      removeUpdateListener?.();
      removeTaskListener?.();
    };
  }, []);

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
      setTaskEvidence(evidence);
      setProposals(nextProposals);
      setLastTask(evidence.prompt);
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
    setProposals((prev) => prev.map((p) => (p.id === actionId ? updated : p)));
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
                className={`nav-item ${item.active ? "active" : ""}`}
                key={item.label}
                type="button"
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

          <div className="content-grid">
            <section className="hero-card">
              <div className="hero-intro">
                <div className="hero-copy">
                  <span className={`status-pill state-${agentState}`}>
                    {reaction.label}
                  </span>
                  <h2>What should we investigate?</h2>
                  <p>
                    Describe a focused task. NASai will inspect the selected
                    workspace, load project rules, and capture evidence without
                    changing project files.
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

            <aside className="readiness-card">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">PREFLIGHT</span>
                  <h3>Workspace readiness</h3>
                </div>
                <span className="score">{workspace ? "3 checks" : "0/3"}</span>
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
              <button className="review-link" type="button">
                Review operating charter <span>→</span>
              </button>
            </aside>

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
                      <span
                        className={`evidence-state ${check.state.toLowerCase().replace(" ", "-")}`}
                      >
                        {check.state}
                      </span>
                      <strong>{check.label}</strong>
                      <small>{check.detail}</small>
                    </div>
                  ))}
                </div>
              )}
              {proposals.length > 0 && (
                <section
                  className="proposals-section"
                  aria-label="Proposed actions"
                >
                  <div className="proposals-header">
                    <div>
                      <span className="eyebrow">APPROVAL GATE</span>
                      <h4>
                        Proposed actions ({pendingSensitiveCount} awaiting
                        approval)
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
                          <span
                            className={`risk-badge risk-${proposal.riskLevel}`}
                          >
                            ▲ RISK: {proposal.riskLevel.toUpperCase()}
                          </span>
                          <span className="proposal-kind">{proposal.kind}</span>
                          <span
                            className={`proposal-status status-${proposal.status}`}
                          >
                            {proposal.status.replaceAll("_", " ").toUpperCase()}
                          </span>
                        </div>
                        <div className="proposal-body">
                          <strong>{proposal.description}</strong>
                          <p className="proposal-reason">{proposal.reason}</p>
                          <div className="proposal-target">
                            <span>Affected target:</span>{" "}
                            <code>{proposal.target}</code>
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
                                onClick={() =>
                                  void saveProposalEdit(proposal.id)
                                }
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
                          </>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </section>

            <aside className="update-card">
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
            </aside>
          </div>
          <footer>
            <span>Evidence-first agent shell</span>
            <span>Local-first · Human approval · Recoverable changes</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
