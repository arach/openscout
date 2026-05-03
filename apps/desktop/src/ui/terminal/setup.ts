import type {
  ScoutDoctorReport,
  ScoutProjectInventoryEntry,
  ScoutRuntimesReport,
  ScoutSetupReport,
} from "../../core/setup/service.ts";

type LocalEdgeReport = ScoutDoctorReport["localEdge"];

export function renderScoutDoctorStreamingLead(input: { repoRoot: string; currentDirectory: string }): string {
  return [
    "Scout doctor",
    `Repo root: ${input.repoRoot}`,
    `Context root: ${input.currentDirectory}`,
    "",
    "Discovering projects…",
    "",
  ].join("\n");
}

export function formatScoutDoctorStreamedProjectEntry(project: ScoutProjectInventoryEntry): string {
  const harnesses = project.harnesses
    .map((entry) => `${entry.harness} (${entry.detail})`)
    .join(" | ");

  const lines = [
    `  - ${project.displayName} (${project.agentId})`,
    `    Root: ${project.projectRoot}`,
    `    Source root: ${project.sourceRoot}`,
    `    Relative path: ${project.relativePath}`,
    `    State: ${project.registrationKind === "configured" ? "configured agent" : "discovered project"}`,
    `    Default harness: ${project.defaultHarness}`,
    `    Harnesses: ${harnesses}`,
  ];
  if (project.projectConfigPath) {
    lines.push(`    Manifest: ${project.projectConfigPath}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderScoutDoctorTailAfterStream(report: ScoutDoctorReport): string {
  const roots = report.setup.settings.discovery.workspaceRoots;
  const n = report.setup.projectInventory.length;
  const lines = [
    "",
    `Project inventory: ${n} project${n === 1 ? "" : "s"} (streamed above).`,
    "",
    `Support directory: ${report.setup.supportDirectory}`,
    `Settings: ${report.setup.settingsPath}`,
    `Harness catalog: ${report.setup.harnessCatalogPath}`,
    `Agent registry: ${report.setup.relayAgentsPath}`,
    `Current project config: ${report.setup.currentProjectConfigPath ?? "not found"}`,
    "",
    "Source roots:",
    ...(roots.length > 0 ? roots.map((root) => `  - ${root}`) : ["  (none — Scout is not scanning any parent folders for repos.)"]),
    ...(roots.length === 0
      ? [
          "",
          "Tip: Set discovery.workspaceRoots in your OpenScout settings file, or run `scout setup --source-root <path>`.",
        ]
      : []),
    ...(roots.length > 0 && n === 0
      ? [
          "",
          "Tip: Under each source root, projects need a signal such as .git, a language manifest (Cargo.toml,",
          "go.mod, pyproject.toml, Gemfile, Package.swift, …), or agent docs (CLAUDE.md, AGENTS.md).",
          "Symlinked directories are followed.",
        ]
      : []),
    "",
    "Agent defaults:",
    `  Harness: ${report.setup.settings.agents.defaultHarness}`,
    `  Capabilities: ${report.setup.settings.agents.defaultCapabilities.join(", ")}`,
    `  Session prefix: ${report.setup.settings.agents.sessionPrefix}`,
    "",
    "Broker:",
    `  Label: ${report.broker.label}`,
    `  URL: ${report.broker.brokerUrl}`,
    `  Installed: ${report.broker.installed ? "yes" : "no"}`,
    `  Loaded: ${report.broker.loaded ? "yes" : "no"}`,
    `  Reachable: ${report.broker.reachable ? "yes" : "no"}`,
    `  LaunchAgent: ${report.broker.launchAgentPath}`,
    `  Broker stdout: ${report.broker.stdoutLogPath}`,
    `  Broker stderr: ${report.broker.stderrLogPath}`,
    "",
    ...renderLocalEdgeReport(report.localEdge),
    "",
    `Known runtimes: ${report.catalog.entries.length}`,
  ];

  for (const entry of report.catalog.entries) {
    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
    if (entry.readinessReport.missing.length > 0) {
      lines.push(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

function renderProjectInventory(projects: ScoutProjectInventoryEntry[]): string[] {
  const lines = [`Project inventory: ${projects.length}`];
  if (projects.length === 0) {
    lines.push("  No projects discovered yet.");
    return lines;
  }

  for (const project of projects) {
    const harnesses = project.harnesses
      .map((entry) => `${entry.harness} (${entry.detail})`)
      .join(" | ");

    lines.push(`  - ${project.displayName} (${project.agentId})`);
    lines.push(`    Root: ${project.projectRoot}`);
    lines.push(`    Source root: ${project.sourceRoot}`);
    lines.push(`    Relative path: ${project.relativePath}`);
    lines.push(`    State: ${project.registrationKind === "configured" ? "configured agent" : "discovered project"}`);
    lines.push(`    Default harness: ${project.defaultHarness}`);
    lines.push(`    Harnesses: ${harnesses}`);
    if (project.projectConfigPath) {
      lines.push(`    Manifest: ${project.projectConfigPath}`);
    }
  }

  return lines;
}

function renderLocalEdgeReport(report: LocalEdgeReport): string[] {
  const lines = [
    "Local edge:",
    `  Caddy: ${report.status}`,
    `  Detail: ${report.detail}`,
  ];
  if (report.caddyPath) {
    lines.push(`  Path: ${report.caddyPath}`);
  }
  if (report.caddyVersion) {
    lines.push(`  Version: ${report.caddyVersion}`);
  }
  if (report.installCommand) {
    lines.push(`  Install: ${report.installCommand}`);
  }
  return lines;
}

export function renderScoutDoctorReport(report: ScoutDoctorReport): string {
  const roots = report.setup.settings.discovery.workspaceRoots;
  const lines = [
    "Scout doctor",
    `Repo root: ${report.repoRoot}`,
    `Context root: ${report.currentDirectory}`,
    `Support directory: ${report.setup.supportDirectory}`,
    `Settings: ${report.setup.settingsPath}`,
    `Harness catalog: ${report.setup.harnessCatalogPath}`,
    `Agent registry: ${report.setup.relayAgentsPath}`,
    `Current project config: ${report.setup.currentProjectConfigPath ?? "not found"}`,
    "",
    "Source roots:",
    ...(roots.length > 0 ? roots.map((root) => `  - ${root}`) : ["  (none — Scout is not scanning any parent folders for repos.)"]),
    ...(roots.length === 0
      ? [
          "",
          "Tip: Set discovery.workspaceRoots in your OpenScout settings file, or run `scout setup --source-root <path>`.",
        ]
      : []),
    ...(roots.length > 0 && report.setup.projectInventory.length === 0
      ? [
          "",
          "Tip: Under each source root, projects need a signal such as .git, a language manifest (Cargo.toml,",
          "go.mod, pyproject.toml, Gemfile, Package.swift, …), or agent docs (CLAUDE.md, AGENTS.md).",
          "Symlinked directories are followed.",
        ]
      : []),
    "",
    "Agent defaults:",
    `  Harness: ${report.setup.settings.agents.defaultHarness}`,
    `  Capabilities: ${report.setup.settings.agents.defaultCapabilities.join(", ")}`,
    `  Session prefix: ${report.setup.settings.agents.sessionPrefix}`,
    "",
    ...renderProjectInventory(report.setup.projectInventory),
    "",
    "Broker:",
    `  Label: ${report.broker.label}`,
    `  URL: ${report.broker.brokerUrl}`,
    `  Installed: ${report.broker.installed ? "yes" : "no"}`,
    `  Loaded: ${report.broker.loaded ? "yes" : "no"}`,
    `  Reachable: ${report.broker.reachable ? "yes" : "no"}`,
    `  LaunchAgent: ${report.broker.launchAgentPath}`,
    `  Broker stdout: ${report.broker.stdoutLogPath}`,
    `  Broker stderr: ${report.broker.stderrLogPath}`,
    "",
    ...renderLocalEdgeReport(report.localEdge),
    "",
    `Known runtimes: ${report.catalog.entries.length}`,
  ];

  for (const entry of report.catalog.entries) {
    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
    if (entry.readinessReport.missing.length > 0) {
      lines.push(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

export function renderScoutSetupReport(report: ScoutSetupReport): string {
  const lines = [
    "Scout initialized.",
    `Context root: ${report.currentDirectory}`,
    `Support directory: ${report.setup.supportDirectory}`,
    `Settings: ${report.setup.settingsPath}`,
    `Harness catalog: ${report.setup.harnessCatalogPath}`,
    `Agent registry: ${report.setup.relayAgentsPath}`,
    `Current project config: ${report.setup.currentProjectConfigPath ?? "not created"}`,
    `Created project config: ${report.setup.createdProjectConfig ? "yes" : "no"}`,
    "",
    "Source roots:",
    ...report.setup.settings.discovery.workspaceRoots.map((root) => `  - ${root}`),
    "",
    ...renderProjectInventory(report.setup.projectInventory),
    "",
    "Broker:",
    `  Label: ${report.broker.label}`,
    `  URL: ${report.broker.brokerUrl}`,
    `  Reachable: ${report.broker.reachable ? "yes" : "no"}`,
    `  LaunchAgent: ${report.broker.launchAgentPath}`,
    `  Logs: ${report.broker.stdoutLogPath} | ${report.broker.stderrLogPath}`,
  ];

  if (report.brokerWarning) {
    lines.push(`  Warning: ${report.brokerWarning}`);
  }

  lines.push("", ...renderLocalEdgeReport(report.localEdge));

  lines.push("", "Harnesses:");
  for (const entry of report.catalog.entries) {
    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
  }

  lines.push(
    "",
    "Next:",
    "  scout doctor",
    "  scout runtimes",
  );

  return lines.join("\n");
}

export function renderScoutRuntimesReport(report: ScoutRuntimesReport): string {
  const lines = [
    `Context root: ${report.currentDirectory}`,
    `Harness catalog: ${report.harnessCatalogPath}`,
    `Known runtimes: ${report.catalog.entries.length}`,
  ];

  for (const entry of report.catalog.entries) {
    const support = Object.entries(entry.support)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key)
      .join(", ");

    lines.push(`  - ${entry.label} (${entry.name})`);
    lines.push(`    State: ${entry.readinessReport.state}`);
    lines.push(`    Detail: ${entry.readinessReport.detail}`);
    lines.push(`    Support: ${support || "none"}`);
    if (entry.readinessReport.binaryPath) {
      lines.push(`    Binary: ${entry.readinessReport.binaryPath}`);
    }
    if (entry.readinessReport.missing.length > 0) {
      lines.push(`    Missing: ${entry.readinessReport.missing.join(" | ")}`);
    }
    if (entry.readinessReport.loginCommand) {
      lines.push(`    Login: ${entry.readinessReport.loginCommand}`);
    }
  }

  return lines.join("\n");
}
