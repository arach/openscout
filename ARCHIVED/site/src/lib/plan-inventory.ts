import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const PLAN_ROOTS = ["plans", ".openscout/plans"] as const;

export type PlanStatus =
  | "awaiting-review"
  | "in-progress"
  | "completed"
  | "paused"
  | "draft";

export interface PlanRecord {
  agent: string;
  agentId: string;
  id: string;
  markdown: string;
  path: string;
  slug: string;
  status: PlanStatus;
  stepsCompleted: number;
  stepsTotal: number;
  summary: string;
  tags: string[];
  title: string;
  updatedAt: string;
}

async function walkMarkdownFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await walkMarkdownFiles(fullPath)));
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(".md")) {
        files.push(fullPath);
      }
    }

    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function parseFrontmatter(source: string): { attributes: Record<string, string>; body: string } {
  const normalized = source.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return { attributes: {}, body: normalized.trim() };
  }

  const endOfFrontmatter = normalized.indexOf("\n---\n", 4);

  if (endOfFrontmatter === -1) {
    return { attributes: {}, body: normalized.trim() };
  }

  const rawAttributes = normalized.slice(4, endOfFrontmatter).trim();
  const body = normalized.slice(endOfFrontmatter + 5).trim();
  const attributes: Record<string, string> = {};

  for (const line of rawAttributes.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

    if (!match) {
      continue;
    }

    attributes[match[1].trim().toLowerCase()] = match[2].trim();
  }

  return { attributes, body };
}

function extractTitle(attributes: Record<string, string>, body: string, slug: string): string {
  if (attributes.title) {
    return attributes.title;
  }

  const heading = body.match(/^#\s+(.+)$/m);

  if (heading) {
    return heading[1].trim();
  }

  return slug
    .split("-")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function extractSummary(attributes: Record<string, string>, body: string): string {
  if (attributes.summary) {
    return attributes.summary;
  }

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith(">") ||
      /^\d+\.\s/.test(trimmed)
    ) {
      continue;
    }

    return trimmed;
  }

  return "No summary yet.";
}

function parseStatus(value: string | undefined): PlanStatus {
  switch (value) {
    case "awaiting-review":
    case "in-progress":
    case "completed":
    case "paused":
    case "draft":
      return value;
    default:
      return "draft";
  }
}

function countChecklistItems(markdown: string): { stepsCompleted: number; stepsTotal: number } {
  let stepsCompleted = 0;
  let stepsTotal = 0;

  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*[-*]\s+\[([ xX])\]\s+/);

    if (!match) {
      continue;
    }

    stepsTotal += 1;

    if (match[1].toLowerCase() === "x") {
      stepsCompleted += 1;
    }
  }

  return { stepsCompleted, stepsTotal };
}

function parseTags(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function buildAgentId(attributes: Record<string, string>, agent: string): string {
  return attributes.agentid || attributes["agent-id"] || `${agent.toLowerCase()}-agent`;
}

function comparePlans(left: PlanRecord, right: PlanRecord): number {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

export async function loadPlanInventory(): Promise<PlanRecord[]> {
  const cwd = process.cwd();
  const discoveredFiles = (
    await Promise.all(PLAN_ROOTS.map((directory) => walkMarkdownFiles(path.join(cwd, directory))))
  ).flat();

  const plans = await Promise.all(
    discoveredFiles.map(async (filePath) => {
      const source = await readFile(filePath, "utf8");
      const { attributes, body } = parseFrontmatter(source);
      const slug = path.basename(filePath, ".md");
      const { stepsCompleted, stepsTotal } = countChecklistItems(body);

      return {
        agent: attributes.agent || "Scout",
        id: attributes.id || slug.toUpperCase(),
        markdown: body,
        path: path.relative(cwd, filePath),
        slug,
        status: parseStatus(attributes.status),
        stepsCompleted,
        stepsTotal,
        summary: extractSummary(attributes, body),
        tags: parseTags(attributes.tags),
        title: extractTitle(attributes, body, slug),
        agentId: buildAgentId(attributes, attributes.agent || "Scout"),
        updatedAt: attributes.updated || new Date().toISOString(),
      } satisfies PlanRecord;
    })
  );

  return plans.sort(comparePlans);
}
