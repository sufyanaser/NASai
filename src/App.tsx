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

export function App() {
  const [update, setUpdate] = useState<UpdateStatus>({
    state: "idle",
    message: "Updates ready",
  });
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    void window.nasai?.getAppInfo().then((info) => setVersion(info.version));
    return window.nasai?.onUpdateStatus(setUpdate);
  }, []);

  const checkUpdates = () => void window.nasai?.checkForUpdates();

  return (
    <main className="app-shell">
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
                <span className="status-pill">NASAI IS READY</span>
                <h2>What should we build?</h2>
                <p>
                  Describe a focused task. NASai will inspect the workspace,
                  load project rules, and ask before any sensitive action.
                </p>
              </div>
              <div className="mascot-stage" aria-hidden="true">
                <span className="mascot-halo" />
                <img src="./brand/nasai-mascot.png" alt="" />
                <span className="mascot-status">Online</span>
              </div>
            </div>
            <div className="prompt-box">
              <textarea
                aria-label="Task description"
                placeholder="Example: Audit the update flow and fix only verified failures…"
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
                <button className="run-button" type="button">
                  Start task <b>↗</b>
                </button>
              </div>
            </div>
            <div className="suggestions">
              <button type="button">Review a change</button>
              <button type="button">Diagnose a failure</button>
              <button type="button">Plan a feature</button>
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
                <h3>Nothing to recover</h3>
              </div>
              <span className="muted">Today</span>
            </div>
            <div className="empty-state">
              <span>◇</span>
              <div>
                <strong>Your verified tasks will appear here</strong>
                <p>
                  Each task keeps its decisions, commands, gate results, and
                  evidence together.
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
    </main>
  );
}
