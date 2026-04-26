type HostStatus = "online" | "degraded" | "offline";
type HostScope = "local" | "cloud" | "sandbox" | "cluster";

const teams = [
  { initials: "JD", name: "Engineering", capacity: "3/4" },
  { initials: "MK", name: "Research", capacity: "3/4" },
  { initials: "AR", name: "Personal Ops", capacity: "2/4" },
  { initials: "SP", name: "Routing & QA", capacity: "1/2" },
];

const computeHosts: Array<{
  agents: number;
  cpu?: number;
  errors?: number;
  gpu?: number;
  host: string;
  icon: string;
  location: string;
  memory?: number;
  name: string;
  platform: string;
  running: number;
  scope: HostScope;
  scopeLabel: string;
  status: HostStatus;
  uptime: string;
}> = [
  {
    name: "MacBook Pro M4",
    host: "atlas.local",
    location: "Brooklyn, NY",
    status: "online",
    scope: "local",
    scopeLabel: "local host",
    uptime: "up 6d 14h",
    cpu: 38,
    memory: 62,
    gpu: 71,
    agents: 3,
    running: 2,
    platform: "macOS",
    icon: "apple",
  },
  {
    name: "Mac Studio",
    host: "forge.local",
    location: "Brooklyn, NY",
    status: "online",
    scope: "local",
    scopeLabel: "local host",
    uptime: "up 21d 3h",
    cpu: 71,
    memory: 84,
    gpu: 92,
    agents: 4,
    running: 3,
    platform: "macOS",
    icon: "apple",
  },
  {
    name: "Linux Rig",
    host: "anvil",
    location: "Home Lab",
    status: "online",
    scope: "local",
    scopeLabel: "local host",
    uptime: "up 47d 2h",
    cpu: 54,
    memory: 47,
    gpu: 88,
    agents: 3,
    running: 3,
    platform: "Linux",
    icon: "server",
  },
  {
    name: "ThinkPad X1",
    host: "scout",
    location: "Mobile",
    status: "degraded",
    scope: "local",
    scopeLabel: "local host",
    uptime: "up 2d 8h",
    cpu: 22,
    memory: 91,
    agents: 2,
    running: 1,
    platform: "Linux",
    icon: "server",
  },
  {
    name: "Cloud Worker",
    host: "fra1.worker-02",
    location: "Frankfurt",
    status: "online",
    scope: "cloud",
    scopeLabel: "cloud instance",
    uptime: "up 12d 0h",
    cpu: 19,
    memory: 34,
    agents: 2,
    running: 0,
    errors: 1,
    platform: "Linux",
    icon: "cloud",
  },
  {
    name: "Codex Sandbox",
    host: "sandbox-a17f",
    location: "us-east-1",
    status: "online",
    scope: "sandbox",
    scopeLabel: "sandbox",
    uptime: "up 42m",
    cpu: 46,
    memory: 58,
    agents: 1,
    running: 1,
    platform: "Firecracker",
    icon: "box",
  },
  {
    name: "GPU Cluster East",
    host: "gpu-east.pool",
    location: "Virginia",
    status: "degraded",
    scope: "cluster",
    scopeLabel: "cluster",
    uptime: "up 18d 6h",
    cpu: 67,
    memory: 72,
    gpu: 89,
    agents: 5,
    running: 4,
    platform: "K8s",
    icon: "cluster",
  },
  {
    name: "Mac Mini (2018)",
    host: "relay.local",
    location: "Brooklyn, NY",
    status: "offline",
    scope: "local",
    scopeLabel: "local host",
    uptime: "up 0m",
    agents: 0,
    running: 0,
    platform: "macOS",
    icon: "apple",
  },
];

const navItems = [
  { icon: "grid", label: "Fleet" },
  { icon: "users", label: "Teams", badge: "4" },
  { icon: "nodes", label: "Agents", badge: "9" },
  { icon: "chip", label: "Compute", badge: "5", active: true },
  { icon: "alert", label: "Alerts", badge: "5", danger: true },
];

const stats = [
  { label: "Online hosts", value: "5", note: "of 8 compute targets" },
  { label: "Degraded", value: "2", note: "needs capacity check" },
  { label: "Avg CPU", value: "45%", note: "active hosts" },
  { label: "Avg Memory", value: "64%", note: "1 offline" },
];

const scopeSummary = [
  { label: "Local", value: 5 },
  { label: "Cloud", value: 1 },
  { label: "Sandboxes", value: 1 },
  { label: "Clusters", value: 1 },
];

export default function HomePage() {
  return (
    <main className="console-shell">
      <aside className="console-sidebar" aria-label="Fleet navigation">
        <div className="brand">
          <div className="brand-mark">⌁</div>
          <div>
            <strong>agentctl</strong>
            <span>ops console</span>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <a className={item.active ? "active" : ""} href="#" key={item.label}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.badge ? <em className={item.danger ? "danger" : ""}>{item.badge}</em> : null}
            </a>
          ))}
        </nav>

        <SidebarSection title="Teams" pulse>
          {teams.map((team) => (
            <div className="sidebar-row" key={team.name}>
              <span className="avatar">{team.initials}</span>
              <span>{team.name}</span>
              <em>{team.capacity}</em>
            </div>
          ))}
        </SidebarSection>

        <SidebarSection title="Hosts">
          {computeHosts.map((host) => (
            <div className="sidebar-row" key={host.name}>
              <span className={`status-dot ${host.status}`} />
              <span>{host.name}</span>
              <em>{host.agents}</em>
            </div>
          ))}
        </SidebarSection>

        <div className="profile-card">
          <div className="profile-orb" />
          <div>
            <strong>jordan</strong>
            <span>workspace · personal</span>
          </div>
          <span className="status-dot online" />
        </div>
      </aside>

      <section className="console-main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Fleet</span>
            <span>›</span>
            <strong>Compute</strong>
          </div>
          <div className="topbar-tools">
            <div className="usage-pill">
              <span className="status-dot online" />
              <strong>38</strong> active <i /> <strong>120.79M</strong> tok/24h <i /> <strong>$691.16</strong> /24h
            </div>
            <label className="search-box">
              <Icon name="search" />
              <span>Search agents, sessions...</span>
              <kbd>⌘ K</kbd>
            </label>
            <button className="icon-button" type="button" aria-label="Filters">
              <Icon name="sliders" />
            </button>
          </div>
        </header>

        <div className="compute-view">
          <section className="hero-copy">
            <span className="console-eyebrow">Compute</span>
            <h1>Hosts running your agents</h1>
            <p>Owned devices, rented instances, sandboxes, and clusters — every place your fleet can execute.</p>
            <div className="scope-row" aria-label="Compute scope summary">
              {scopeSummary.map((item) => (
                <span className="scope-pill" key={item.label}>
                  <strong>{item.value}</strong> {item.label}
                </span>
              ))}
            </div>
          </section>

          <section className="metric-grid" aria-label="Compute summary">
            {stats.map((stat) => (
              <article className="metric-card" key={stat.label}>
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
                {stat.note ? <p>{stat.note}</p> : null}
              </article>
            ))}
          </section>

          <div className="section-label">
            <span>Hosts</span>
            <strong>5/8 online · 20 agents</strong>
          </div>

          <section className="host-grid" aria-label="Compute hosts">
            {computeHosts.map((host) => (
              <HostCard host={host} key={host.name} />
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}

function SidebarSection({
  children,
  pulse,
  title,
}: {
  children: React.ReactNode;
  pulse?: boolean;
  title: string;
}) {
  return (
    <section className="sidebar-section">
      <h2>
        {title}
        {pulse ? <Icon name="activity" /> : null}
      </h2>
      {children}
    </section>
  );
}

function HostCard({ host }: { host: (typeof computeHosts)[number] }) {
  const metrics = [
    { label: "CPU", value: host.cpu },
    { label: "MEM", value: host.memory },
    { label: "GPU", value: host.gpu },
  ].filter((metric): metric is { label: string; value: number } => typeof metric.value === "number");

  return (
    <article className={`host-card ${host.status}`}>
      <header>
        <div className="host-icon">
          <Icon name={host.icon} />
        </div>
        <div>
          <h2>
            <span className={`status-dot ${host.status}`} />
            {host.name}
          </h2>
          <p>
            {host.host} · {host.location}
          </p>
        </div>
        <div className="host-state">
          <span>{host.status}</span>
          <em>{host.uptime}</em>
        </div>
      </header>

      {host.status === "offline" ? (
        <div className="offline-note">host unreachable · last seen 6d ago</div>
      ) : (
        <div className="metric-bars">
          {metrics.map((metric) => (
            <div className="bar-row" key={metric.label}>
              <span>{metric.label}</span>
              <div className="bar-track">
                <div className={barClass(metric.value)} style={{ width: `${metric.value}%` }} />
              </div>
              <strong>{metric.value}%</strong>
            </div>
          ))}
        </div>
      )}

      <footer>
        <div>
          <strong>{host.agents}</strong> agents <strong className="accent">{host.running}</strong> running
          {host.errors ? <strong className="error"> {host.errors} errors</strong> : null}
        </div>
        <span>
          {host.scopeLabel} · {host.platform}
        </span>
      </footer>
    </article>
  );
}

function barClass(value: number) {
  if (value >= 90) {
    return "bar-fill danger";
  }

  if (value >= 80) {
    return "bar-fill warn";
  }

  return "bar-fill";
}

function Icon({ name }: { name: string }) {
  const commonProps = {
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 1.7,
    viewBox: "0 0 24 24",
  };

  const paths: Record<string, React.ReactNode> = {
    activity: <path d="M4 12h4l2-5 4 10 2-5h4" />,
    alert: <path d="M12 4 3 20h18L12 4Zm0 6v4m0 3h.01" />,
    apple: <path d="M16 8c-2 0-2.4 1-4 1s-2-1-4-1c-2 0-4 2-4 5.2C4 17 6.1 20 8 20c1 0 1.7-.6 4-.6s3 .6 4 .6c1.9 0 4-3 4-6.8C20 10 18 8 16 8Zm-2-4c0 1.6-1.2 3-3 3 0-1.7 1.3-3 3-3Z" />,
    box: <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm0 9 8-4.5M12 12 4 7.5m8 4.5v9" />,
    chip: <path d="M8 3v3m8-3v3M8 18v3m8-3v3M3 8h3m-3 8h3m12-8h3m-3 8h3M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm2 4h4v4h-4z" />,
    cloud: <path d="M7 18h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.3-1.8A5 5 0 0 0 7 18Z" />,
    cluster: <path d="M7 7h4v4H7zM13 7h4v4h-4zM10 13h4v4h-4zM9 11v2m6-2-2 2" />,
    grid: <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />,
    nodes: <path d="M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm10 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2.5-15L14 10.5M9.5 17l4.5-4" />,
    search: <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />,
    server: <path d="M5 4h14v6H5zM5 14h14v6H5zM8 7h.01M8 17h.01" />,
    sliders: <path d="M4 6h8m4 0h4M4 12h4m4 0h8M4 18h10m4 0h2M12 4v4m-4 2v4m6 2v4" />,
    users: <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm11 10v-2a4 4 0 0 0-3-3.8m-2-11.1a4 4 0 0 1 0 7.8" />,
  };

  return <svg {...commonProps}>{paths[name]}</svg>;
}
