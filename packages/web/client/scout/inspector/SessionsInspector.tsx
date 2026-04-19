import { useCallback, useEffect, useState } from "react";
import { useScout } from "../Provider.tsx";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type { SessionEntry } from "../../lib/types.ts";

export function SessionsInspector() {
  const { route } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);

  const load = useCallback(async () => {
    try {
      setSessions(await api<SessionEntry[]>("/api/sessions"));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useBrokerEvents(load);

  if (route.view !== "sessions") return null;

  const selected = route.sessionId
    ? sessions.find((s) => s.id === route.sessionId) ?? null
    : null;

  if (!selected) {
    const kinds = new Set(sessions.map((s) => s.kind));
    const withBranch = sessions.filter((s) => s.currentBranch).length;
    return (
      <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
        <Row label="Total" value={`${sessions.length}`} />
        <Row label="Kinds" value={`${kinds.size}`} />
        <Row label="Branched" value={`${withBranch}`} />
        <div className="mt-2 text-[10px] font-mono uppercase tracking-[0.15em] text-white/25 leading-relaxed">
          Select a session from the list to see its context here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto frame-scrollbar p-4 gap-4 text-[11px]">
      <div className="pb-3 border-b border-white/[0.04]">
        <div className="text-[13px] text-white/90 leading-snug">
          {selected.title}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-400/70 mt-1">
          {selected.kind}
        </div>
      </div>

      {selected.agentName && (
        <Section label="Agent">
          <Row label="Name" value={selected.agentName} />
          {selected.harness && <Row label="Harness" value={selected.harness} />}
        </Section>
      )}

      {(selected.currentBranch || selected.workspaceRoot) && (
        <Section label="Workspace">
          {selected.currentBranch && (
            <Row label="Branch" value={selected.currentBranch} />
          )}
          {selected.workspaceRoot && (
            <Row label="Root" value={selected.workspaceRoot} />
          )}
        </Section>
      )}

      <Section label="Activity">
        <Row label="Messages" value={`${selected.messageCount}`} />
        {selected.lastMessageAt && (
          <Row label="Last" value={timeAgo(selected.lastMessageAt)} />
        )}
        {selected.participantIds.length > 0 && (
          <Row label="Participants" value={`${selected.participantIds.length}`} />
        )}
      </Section>

      {selected.preview && (
        <Section label="Preview">
          <div className="text-[11px] text-white/60 leading-relaxed italic">
            "{selected.preview}"
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/30 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 gap-2">
      <span className="text-[10px] font-mono uppercase tracking-wider text-white/30 shrink-0">
        {label}
      </span>
      <span className="text-[11px] text-white/70 font-mono truncate">
        {value}
      </span>
    </div>
  );
}
