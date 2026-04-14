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

export function renderWithMentions(text: string | null | undefined): ReactNode {
  if (!text) return text ?? "";
  const identities = extractAgentIdentities(text);
  const segments = segmentize(text, identities);

  return segments.map((segment, index) => {
    if (segment.kind === "text") {
      return <span key={index}>{segment.value}</span>;
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
