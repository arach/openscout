import type { ScoutCommandContext } from "../context.ts";
import {
  loadMeshStatus,
  loadMeshDoctorReport,
  runMeshDiscover,
  runMeshPing,
  loadMeshNodes,
} from "../../core/mesh/service.ts";
import {
  renderMeshStatus,
  renderMeshDoctor,
  renderMeshDiscover,
  renderMeshPing,
  renderMeshNodes,
} from "../../ui/terminal/mesh.ts";

const MESH_HELP = `scout mesh — Mesh status and diagnostics

Subcommands:
  scout mesh              Show mesh status (default)
  scout mesh doctor       Full mesh diagnostics
  scout mesh nodes        List known mesh nodes
  scout mesh discover     Probe for remote mesh nodes
  scout mesh ping <node>  Ping a specific node by ID, name, or URL
`;

export async function runMeshCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const subcommand = args[0] ?? "";

  switch (subcommand) {
    case "":
    case "status": {
      const report = await loadMeshStatus();
      context.output.writeValue(report, renderMeshStatus);
      return;
    }

    case "doctor": {
      const report = await loadMeshDoctorReport();
      context.output.writeValue(report, renderMeshDoctor);
      return;
    }

    case "nodes": {
      const result = await loadMeshNodes();
      context.output.writeValue(result, renderMeshNodes);
      return;
    }

    case "discover": {
      const report = await runMeshDiscover();
      context.output.writeValue(report, renderMeshDiscover);
      return;
    }

    case "ping": {
      const target = args[1]?.trim();
      if (!target) {
        context.stderr("Usage: scout mesh ping <node-id|name|url>");
        return;
      }
      const report = await runMeshPing(target);
      context.output.writeValue(report, renderMeshPing);
      return;
    }

    case "help":
    case "--help":
    case "-h": {
      context.output.writeText(MESH_HELP);
      return;
    }

    default: {
      context.stderr(`Unknown mesh subcommand: ${subcommand}`);
      context.output.writeText(MESH_HELP);
    }
  }
}
