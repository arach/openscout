import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";
import { parseContextRootCommandOptions } from "../options.ts";
import { loadScoutDoctorReport } from "../../core/setup/service.ts";
import { resolveScoutWorkspaceRoot } from "../../shared/paths.ts";
import {
  formatScoutDoctorStreamedProjectEntry,
  renderScoutDoctorStreamingLead,
  renderScoutDoctorTailAfterStream,
} from "../../ui/terminal/setup.ts";

const DOCTOR_JSON_SCHEMA = "scout.doctor.v1" as const;

function writeDoctorJsonLine(context: ScoutCommandContext, payload: Record<string, unknown>): void {
  context.output.writeText(`${JSON.stringify({ schema: DOCTOR_JSON_SCHEMA, ...payload })}\n`);
}

export async function runDoctorCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const options = parseContextRootCommandOptions("doctor", args, defaultScoutContextDirectory(context));
  const repoRoot = (() => {
    try {
      return resolveScoutWorkspaceRoot();
    } catch {
      return options.currentDirectory;
    }
  })();

  if (context.output.mode === "plain") {
    context.output.writeText(
      renderScoutDoctorStreamingLead({
        repoRoot,
        currentDirectory: options.currentDirectory,
      }),
    );
    const report = await loadScoutDoctorReport({
      currentDirectory: options.currentDirectory,
      repoRoot,
      onProjectInventoryEntry: (entry) => {
        context.output.writeText(formatScoutDoctorStreamedProjectEntry(entry));
      },
    });
    if (report.setup.projectInventory.length === 0) {
      context.output.writeText("  No projects discovered yet.\n");
    }
    context.output.writeText(renderScoutDoctorTailAfterStream(report));
    return;
  }

  writeDoctorJsonLine(context, {
    phase: "start",
    repoRoot,
    currentDirectory: options.currentDirectory,
  });

  const report = await loadScoutDoctorReport({
    currentDirectory: options.currentDirectory,
    repoRoot,
    onProjectInventoryEntry: (entry) => {
      writeDoctorJsonLine(context, { phase: "project", project: entry });
    },
  });

  writeDoctorJsonLine(context, { phase: "complete", report });
}
