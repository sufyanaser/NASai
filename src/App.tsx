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

const checks = [
  ["Workspace scope", "Ready"],
  ["Project rules", "Loaded"],
  ["Quality gates", "4 configured"],
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
    label: "Building",
    message: "I’m working through the task.",
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

const wait = (duration: number) =>
  new Promise((resolve) => setTimeout(resolve, duration));

export function App() {
  const [update, setUpdate] = useState<UpdateStatus>({
    state: "idle",
    message: "Updates ready",
  });
  const [version, setVersion] = useState("0.1.0");
  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [task, setTask] = useState("");
  const [lastTask, setLastTask] = useState<string | null>(null);
  const reaction = reactions[agentState];
  const isRunning = ["thinking", "working", "verifying"].includes(agentState);

  useEffect(() => {
    void window.nasai?.getAppInfo().then((info) => setVersion(info.version));
    return window.nasai?.onUpdateStatus(setUpdate);
  }, []);

  const checkUpdates = () => void window.nasai?.checkForUpdates();

  const runTask = async () => {
    if (!task.trim() || isRunning) return;
    setAgentState("thinking");
    await wait(950);
    setAgentState("working");
    await wait(1250);
    setAgentState("verifying");
    await wait(950);

    if (/\b(error|fail|blocked)\b/i.test(task)) {
      setAgentState("attention");
      return;
    }

    setLastTask(task.trim());
    setAgentState("success");
  };

  const acknowledgeMascot = () => {
    if (isRunning) return;
    setAgentState(agentState === "idle" ? "success" : "idle");
  };

  return (
    <main className="application-frame">
      <header className="window-bar">
        <div className="window-drag-region">
          <img src="./brand/nasai-mark-mono.svg" alt="" />
          <span>NASai</span>
          <span className="window-context">Workspace</span>
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
              <h1>Build with evidence, not assumptions.</h1>
            </div>
            <div className="top-actions">
              <span className="connection">
                <i /> Local
              </span>
              <button className="ghost-button" type="button">
                Settings
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
                  <h2>What should we build?</h2>
                  <p>
                    Describe a focused task. NASai will inspect the workspace,
                    load project rules, and ask before any sensitive action.
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
                  <span>Scope is limited to this workspace</span>
                  <button
                    className="run-button"
                    type="button"
                    onClick={() => void runTask()}
                    disabled={!task.trim() || isRunning}
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
                <span className="score">3/3</span>
              </div>
              <div className="checks">
                {checks.map(([name, state]) => (
                  <div className="check" key={name}>
                    <span className="checkmark">✓</span>
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
                      ? "All configured checks passed. Evidence is ready for review."
                      : "Each task keeps its decisions, commands, gate results, and evidence together."}
                  </p>
                </div>
              </div>
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
