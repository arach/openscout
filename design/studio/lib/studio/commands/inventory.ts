import { runInventory, type InventoryResult } from "@/lib/inventory";
import type { Command } from "@/lib/studio/command";

export interface InventoryInput {
  /** Window in days, e.g. "7d". */
  since: string;
}

export const inventoryCommand: Command<InventoryInput, InventoryResult> = {
  id: "inventory",
  label: "Inventory",
  shell: ({ since }) => {
    const days = parseSinceDays(since);
    return `find ~/.codex/sessions ~/.claude/projects -name '*.jsonl' -mtime -${days}`;
  },
  run: async (_input) => {
    // runInventory currently has its own 7d window + module cache; the input
    // is accepted for shape parity but not threaded through yet. When we add
    // a second input (project filter, harness filter), runInventory will grow
    // an args object.
    return runInventory();
  },
  cacheKey: ({ since }) => `since:${since}`,
  // runInventory has its own 60s cache; the command-level cache is redundant
  // for now but harmless. Leave at 0 to let the inner cache do the work.
  cacheTtlMs: 0,
};

function parseSinceDays(since: string): number {
  const m = since.match(/^(\d+)d$/);
  return m ? Number(m[1]) : 7;
}
