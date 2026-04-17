import type { ReactNode } from "react";
import { extractAgentIdentities, SCOUT_DISPATCHER_AGENT_ID } from "@openscout/protocol";
import type { AgentIdentity } from "@openscout/protocol";
import { actorColor } from "./colors.ts";

type Segment = { kind: "text"; value: string } | { kind: "mention"; identity: AgentIdentity };

/** Split `text` into plain/mention segments using `extractAgentIdentities` aliases. */
function segmentize(text: string, identities: AgentIdentity[]): Segment[] {
  if (identities.length === 0) return [{ kind: "text", value: text }];

  const byLabel = new Map<string, AgentIdentity>();
  for (const id of identities) byLabel.set(id.label.toLowerCase(), id);

  const out: Segment[] = [];
  let remaining = text;
  const pattern = /@([a-z0-9][a-z0-9._/:-]*)/i;

  while (remaining.length > 0) {
    const match = pattern.exec(remaining);
    if (!match || match.index === undefined) {
      out.push({ kind: "text", value: remaining });
      break;
    }
    if (match.index > 0) {
      out.push({ kind: "text", value: remaining.slice(0, match.index) });
    }
    const raw = match[0];
    const label = raw.toLowerCase();
    const identity = byLabel.get(label);
    if (identity) {
      out.push({ kind: "mention", identity });
    } else {
      out.push({ kind: "text", value: raw });
    }
    remaining = remaining.slice(match.index + raw.length);
  }

  return out;
}

function renderInlineMarkdown(value: string, keyBase: number): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let sub = 0;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) {
      parts.push(<span key={`${keyBase}-${sub++}`}>{value.slice(cursor, match.index)}</span>);
    }
    parts.push(<strong key={`${keyBase}-${sub++}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) {
    parts.push(<span key={`${keyBase}-${sub++}`}>{value.slice(cursor)}</span>);
  }
  return parts.length > 0 ? parts : [<span key={keyBase}>{value}</span>];
}

export function renderWithMentions(text: string | null | undefined): ReactNode {
  if (!text) return text ?? "";
  const identities = extractAgentIdentities(text);
  const segments = segmentize(text, identities);

  return segments.flatMap((segment, index) => {
    if (segment.kind === "text") {
      return renderInlineMarkdown(segment.value, index * 100);
    }
    const { identity } = segment;
    const isScout = identity.definitionId === SCOUT_DISPATCHER_AGENT_ID;
    const color = isScout ? "var(--accent)" : actorColor(identity.definitionId);
    return (
      <span
        key={index}
        className="s-mention"
        style={{ "--mention-color": color } as React.CSSProperties}
      >
        {identity.label}
      </span>
    );
  });
}
