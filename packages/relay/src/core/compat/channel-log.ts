import type { RelayStoredMessage } from "../protocol/events.js";

function formatTagPrefix(tags?: string[]): string {
  return tags?.length ? tags.map((tag) => `[${tag}]`).join(" ") + " " : "";
}

export function decorateRelayMessageBody(message: Pick<RelayStoredMessage, "body" | "tags">): string {
  return `${formatTagPrefix(message.tags)}${message.body}`;
}

export function formatRelayLogLine(message: RelayStoredMessage): string {
  return `${message.ts} ${message.from} ${message.type} ${decorateRelayMessageBody(message)}\n`;
}

export function parseRelayLogLine(line: string, sequence: number): RelayStoredMessage | null {
  const parts = line.split(" ");
  if (parts.length < 3) return null;

  const [tsStr, from, type, ...rest] = parts;
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return null;
  if (type !== "MSG" && type !== "SYS") return null;

  const bodyWithTags = rest.join(" ");
  const tags: string[] = [];
  let body = bodyWithTags;

  while (body.startsWith("[")) {
    const end = body.indexOf("]");
    if (end <= 1) break;

    tags.push(body.slice(1, end));
    body = body.slice(end + 1).trimStart();
  }

  return {
    id: `legacy-${sequence}`,
    ts,
    from,
    type,
    body,
    tags: tags.length ? tags : undefined,
  };
}
