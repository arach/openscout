import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { useFocusTrap } from "../../lib/keyboard-nav.ts";
import { newSessionPayloadForAgent, type SessionInitiationResult } from "./model.ts";
import type { Agent, Route } from "../../lib/types.ts";
import "./agents-rail.css";

type Navigate = (route: Route) => void;

/**
 * New chat composer — the rail action that starts a fresh conversation. Pick an
 * agent, type a first message, and POST /api/sessions (the message rides in
 * `seed.instructions`). Raised over the list as a focused dialog; closes on Esc
 * or backdrop. The agent picker is what lets New chat work from the bare list,
 * where there's no selection to inherit.
 */
export function NewChatComposer({
  agents,
  navigate,
  onClose,
  initialAgentId,
}: {
  agents: Agent[];
  navigate: Navigate;
  onClose: () => void;
  initialAgentId?: string;
}) {
  const sorted = useMemo(
    () => [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)),
    [agents],
  );
  const [agentId, setAgentId] = useState(() => initialAgentId ?? sorted[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "starting">("idle");
  const [error, setError] = useState<string | null>(null);
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>(true);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  const agent = sorted.find((candidate) => candidate.id === agentId) ?? null;

  const start = async () => {
    if (!agent || state === "starting") return;
    setState("starting");
    setError(null);
    try {
      const payload = newSessionPayloadForAgent(agent);
      const trimmed = message.trim();
      const body = trimmed ? { ...payload, seed: { instructions: trimmed } } : payload;
      const result = await api<SessionInitiationResult>("/api/sessions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const conversationId = result.conversationId?.trim();
      if (!conversationId) {
        throw new Error("Chat started, but no conversation was returned.");
      }
      navigate({
        view: "agents",
        agentId: result.agentId?.trim() || agent.id,
        conversationId,
        tab: "message",
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start a new chat.");
      setState("idle");
    }
  };

  return (
    <div className="s-newchat-backdrop" onClick={onClose} role="presentation">
      <div
        ref={ref}
        className="s-newchat-panel"
        role="dialog"
        aria-modal="true"
        aria-label="New chat"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <header className="s-newchat-head">
          <span className="s-newchat-title">New chat</span>
          <button
            type="button"
            className="s-newchat-close"
            onClick={onClose}
            aria-label="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="s-newchat-body">
          <label className="s-newchat-field">
            <span className="s-newchat-field-label">Agent</span>
            <select
              className="s-newchat-select"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {sorted.length === 0 ? (
                <option value="">No agents available</option>
              ) : (
                sorted.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                    {candidate.project ? ` · ${candidate.project}` : ""}
                  </option>
                ))
              )}
            </select>
          </label>

          {agent && (
            <div className="s-newchat-target">
              {agent.project && <span className="s-newchat-chip">{agent.project}</span>}
              {agent.harness && <span className="s-newchat-chip">{agent.harness}</span>}
              {agent.model && <span className="s-newchat-chip">{agent.model}</span>}
            </div>
          )}

          <textarea
            ref={textRef}
            className="s-newchat-well"
            placeholder="First message…"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void start();
              }
            }}
          />

          {error && <div className="s-newchat-error">{error}</div>}

          <div className="s-newchat-foot">
            <span className="s-newchat-hint">⌘↵ to start</span>
            <button
              type="button"
              className="s-newchat-start"
              disabled={!agent || state === "starting"}
              onClick={() => void start()}
            >
              {state === "starting" ? "Starting…" : "Start"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
