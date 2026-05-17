import type { ScoutVantagePlan } from "../../core/vantage/plan.ts";

export function renderScoutVantagePlan(plan: ScoutVantagePlan): string {
  const nodeCount = plan.manifest.nodes.length;
  const broker = plan.broker.reachable
    ? `broker ${plan.broker.baseUrl ?? "reachable"}`
    : "broker unavailable";
  const diagnostics = plan.diagnostics.length > 0
    ? plan.diagnostics.map((diagnostic) => `  - ${diagnostic.message}`).join("\n")
    : "  - ready";

  return [
    "Scout Vantage plan",
    `Context: ${plan.currentDirectory}`,
    `Source: ${broker}`,
    `Nodes: ${nodeCount}`,
    "",
    "Diagnostics:",
    diagnostics,
    "",
    "Run `scout vantage plan --json` to pass the Hudson Vantage setup manifest to the native app.",
  ].join("\n");
}
