"use client";

import React from "react";
import { TraceActionBlock } from "@openscout/session-trace-react";
import type { ActionBlock, TraceBlockViewModel, TraceIntent } from "@openscout/session-trace";
import type { PairingState } from "@/lib/scout-desktop";

type PendingApproval = NonNullable<PairingState>["pendingApprovals"][number];

type TraceApprovalGroup = {
  sessionId: string;
  sessionName: string;
  adapterType: string;
  approvals: PendingApproval[];
};

type PairingTraceSurfaceProps = {
  pendingApprovals: PendingApproval[];
  pairingApprovalPendingId: string | null;
  onDecideApproval: (approval: PendingApproval, decision: "approve" | "deny") => void;
};

function approvalKey(approval: PendingApproval) {
  return `${approval.sessionId}:${approval.turnId}:${approval.blockId}`;
}

function createApprovalActionBlock(approval: PendingApproval, collapsed: boolean): TraceBlockViewModel {
  const output = approval.detail && approval.detail !== approval.description ? approval.detail : "";
  const action = createActionFromApproval(approval, output);

  return {
    sessionId: approval.sessionId,
    id: approval.blockId,
    turnId: approval.turnId,
    type: "action",
    status: "streaming",
    index: 0,
    label: approval.title,
    summary: approval.description,
    collapsed,
    block: {
      id: approval.blockId,
      turnId: approval.turnId,
      status: "streaming",
      index: 0,
      type: "action",
      action,
    },
  };
}

function createActionFromApproval(approval: PendingApproval, output: string): ActionBlock["action"] {
  const approvalMeta = {
    version: approval.version,
    description: approval.description,
    risk: approval.risk,
  } as const;

  switch (approval.actionKind) {
    case "command":
      return {
        kind: "command",
        status: approval.actionStatus,
        output,
        command: approval.detail ?? approval.description ?? approval.title,
        approval: approvalMeta,
      };
    case "file_change":
      return {
        kind: "file_change",
        status: approval.actionStatus,
        output,
        path: approval.detail ?? approval.description ?? approval.title,
        approval: approvalMeta,
      };
    case "tool_call":
      return {
        kind: "tool_call",
        status: approval.actionStatus,
        output,
        toolName: approval.detail ?? approval.description ?? approval.title,
        toolCallId: approval.blockId,
        approval: approvalMeta,
      };
    case "subagent":
      return {
        kind: "subagent",
        status: approval.actionStatus,
        output,
        agentId: approval.blockId,
        agentName: approval.detail ?? approval.sessionName,
        prompt: approval.description,
        approval: approvalMeta,
      };
  }
}

export function PairingTraceSurface({
  pendingApprovals,
  pairingApprovalPendingId,
  onDecideApproval,
}: PairingTraceSurfaceProps) {
  const [collapsedByBlockId, setCollapsedByBlockId] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (pendingApprovals.length === 0) {
      if (Object.keys(collapsedByBlockId).length > 0) {
        setCollapsedByBlockId({});
      }
      return;
    }

    const activeKeys = new Set(pendingApprovals.map(approvalKey));
    setCollapsedByBlockId((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        if (activeKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [pendingApprovals]);

  const approvalByKey = React.useMemo(() => {
    const map = new Map<string, PendingApproval>();
    for (const approval of pendingApprovals) {
      map.set(approvalKey(approval), approval);
    }
    return map;
  }, [pendingApprovals]);

  const groups = React.useMemo<TraceApprovalGroup[]>(() => {
    const map = new Map<string, TraceApprovalGroup>();
    for (const approval of pendingApprovals) {
      const existing = map.get(approval.sessionId);
      if (existing) {
        existing.approvals.push(approval);
        continue;
      }
      map.set(approval.sessionId, {
        sessionId: approval.sessionId,
        sessionName: approval.sessionName,
        adapterType: approval.adapterType,
        approvals: [approval],
      });
    }

    return [...map.values()]
      .sort((left, right) => left.sessionName.localeCompare(right.sessionName) || left.sessionId.localeCompare(right.sessionId))
      .map((group) => ({
        ...group,
        approvals: [...group.approvals].sort((left, right) => (
          left.title.localeCompare(right.title)
          || left.turnId.localeCompare(right.turnId)
          || left.blockId.localeCompare(right.blockId)
        )),
      }));
  }, [pendingApprovals]);

  const handleIntent = React.useCallback((intent: TraceIntent) => {
    if (intent.type === "collapse") {
      const key = `${intent.sessionId}:${intent.turnId}:${intent.blockId}`;
      setCollapsedByBlockId((current) => ({
        ...current,
        [key]: intent.collapsed,
      }));
      return;
    }

    if (intent.type !== "decide") {
      return;
    }

    const key = `${intent.sessionId}:${intent.turnId}:${intent.blockId}`;
    const approval = approvalByKey.get(key);
    if (!approval) {
      return;
    }

    onDecideApproval(approval, intent.decision);
  }, [approvalByKey, onDecideApproval]);

  if (pendingApprovals.length === 0) {
    return (
      <div className="rounded-2xl border px-4 py-4 text-[12px] leading-[1.7] bg-white" style={{ borderColor: "rgba(15, 23, 42, 0.08)" }}>
        No live approvals are waiting right now. When a session pauses for input, the shared trace surface will appear here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section
          key={group.sessionId}
          className="rounded-2xl border p-4"
          style={{ backgroundColor: "#f7f8fb", borderColor: "rgba(15, 23, 42, 0.08)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium tracking-tight" style={{ color: "#1C1C1A" }}>
                {group.sessionName}
              </div>
              <div className="mt-1 text-[11px] font-light" style={{ color: "#8A8A86" }}>
                {group.adapterType} · {group.sessionId}
              </div>
            </div>
            <span
              className="rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap"
              style={{ backgroundColor: "#fff7ed", borderColor: "#fed7aa", color: "#c2410c" }}
            >
              {group.approvals.length} queued
            </span>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {group.approvals.map((approval) => {
              const key = approvalKey(approval);
              const block = createApprovalActionBlock(approval, collapsedByBlockId[key] ?? false);
              const isBusy = pairingApprovalPendingId === `${key}:approve` || pairingApprovalPendingId === `${key}:deny`;

              return (
                <div
                  key={key}
                  className="rounded-2xl border p-3 pairing-trace-approval-card"
                  style={{
                    backgroundColor: "#ffffff",
                    borderColor: "rgba(15, 23, 42, 0.08)",
                    opacity: isBusy ? 0.72 : 1,
                  }}
                  data-busy={isBusy ? "true" : "false"}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium tracking-tight" style={{ color: "#1C1C1A" }}>
                        {approval.title}
                      </div>
                      <div className="mt-1 text-[11px] leading-[1.5] font-light" style={{ color: "#8A8A86" }}>
                        {approval.description}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[10px] font-mono uppercase tracking-[0.16em]" style={{ color: "#8A8A86" }}>
                      <div>{approval.turnId}</div>
                      <div>{approval.blockId}</div>
                    </div>
                  </div>

                  <TraceActionBlock block={block} onIntent={handleIntent} className="pairing-trace-action" />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
