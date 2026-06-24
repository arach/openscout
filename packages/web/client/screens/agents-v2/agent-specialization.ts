import type { Agent, LocalAgentConfigState } from "../../lib/types.ts";

const CLASS_LABELS: Record<string, string> = {
  general: "Generalist",
  builder: "Builder",
  reviewer: "Reviewer",
  researcher: "Researcher",
  operator: "Operator",
  bridge: "Bridge",
  system: "System",
  organic: "Organic",
  managed: "Managed",
};

export function humanizeAgentClass(agentClass: string | null | undefined): string {
  if (!agentClass?.trim()) return "Generalist";
  const key = agentClass.trim().toLowerCase();
  return CLASS_LABELS[key] ?? agentClass.replace(/_/g, " ");
}

export function humanizeAgentRole(role: string | null | undefined): string | null {
  if (!role?.trim()) return null;
  return role.replace(/_/g, " ").trim();
}

export type AgentSpecialization = {
  kind: string;
  kindRaw: string;
  role: string | null;
  isGeneralist: boolean;
  /** Primary roster label — role when set, otherwise class. */
  headline: string;
  skills: string[];
  capabilities: string[];
};

export function isHangoutGeneralist(spec: AgentSpecialization): boolean {
  return spec.isGeneralist;
}

export function partitionProjectRoster(rows: Array<{
  entry: { leadAgent: Agent; group: { lastActivityAt: number; needs: boolean } };
  config: LocalAgentConfigState | null;
  tone: "needs" | "live" | "idle";
}>): { hangout: typeof rows; experts: typeof rows } {
  const hangout: typeof rows = [];
  const experts: typeof rows = [];
  for (const row of rows) {
    const spec = agentSpecialization(row.entry.leadAgent, row.config);
    if (isHangoutGeneralist(spec)) hangout.push(row);
    else experts.push(row);
  }
  const rank = (row: (typeof rows)[number]) => {
    if (row.tone === "needs") return 0;
    if (row.tone === "live") return 1;
    return 2;
  };
  const sorter = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    rank(a) - rank(b)
    || b.entry.group.lastActivityAt - a.entry.group.lastActivityAt;
  hangout.sort(sorter);
  experts.sort(sorter);
  return { hangout, experts };
}

export function agentSpecialization(
  agent: Agent,
  config?: LocalAgentConfigState | null,
): AgentSpecialization {
  const kindRaw = agent.agentClass?.trim() || "general";
  const kind = humanizeAgentClass(kindRaw);
  const role = humanizeAgentRole(agent.role);
  const skills = [...new Set(agent.skills ?? [])].filter(Boolean);
  const capabilities = [
    ...new Set([...(agent.capabilities ?? []), ...(config?.capabilities ?? [])]),
  ].filter(Boolean);
  const isGeneralist = kindRaw === "general" && !role && skills.length === 0;
  const headline = role ?? kind;

  return {
    kind,
    kindRaw,
    role,
    isGeneralist,
    headline,
    skills,
    capabilities,
  };
}