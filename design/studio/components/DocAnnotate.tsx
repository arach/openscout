"use client";

/**
 * DocAnnotate — select-to-annotate on rendered markdown, wired to the
 * scout broker.
 *
 * Wraps a rendered doc (EngMarkdown). Select any passage → an "Annotate"
 * chip floats at the selection → opens the shared steer InputDock →
 * send POSTs the quote + note to /api/annotate, which dispatches a
 * broker ask against this repo. The receipt (conversation id) renders
 * inline with a fully-qualified link into the web app, so the loop is:
 * read doc → annotate → agent picks it up → reply lands in /messages.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  InputDock,
  STEER_GLASS_PANEL,
  type SteerAction,
  type SteerEvent,
} from "@/components/QuickSteer";

const MAX_QUOTE_CHARS = 600;

const ANNOTATE_EVENT: SteerEvent = {
  id: "doc-annotation",
  agent: "openscout",
  agentHue: 160,
  kind: "artifact",
  label: "Annotate",
  time: "",
};

const ANNOTATE_ACTION: SteerAction = {
  id: "annotate",
  label: "Annotate",
  glyph: "reply",
  needsInput: true,
  inputPlaceholder: "Note for the agent…",
};

interface SelectionState {
  quote: string;
  /** Position relative to the wrapper, anchored under the selection. */
  top: number;
  left: number;
}

interface Receipt {
  conversationId?: string;
  invocationId?: string;
  receipt: string;
}

type Phase =
  | { kind: "chip" }
  | { kind: "dock" }
  | { kind: "sending" }
  | { kind: "sent"; receipt: Receipt }
  | { kind: "error"; message: string };

export function DocAnnotate({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  const keyframeId = useId().replace(/:/g, "");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<SelectionState | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "chip" });

  const clear = useCallback(() => {
    setSel(null);
    setPhase({ kind: "chip" });
  }, []);

  const onMouseUp = useCallback(() => {
    // A dock/result panel in progress owns the surface; ignore stray clicks.
    if (phase.kind !== "chip") return;
    const wrap = wrapRef.current;
    const selection = window.getSelection();
    if (!wrap || !selection || selection.isCollapsed) {
      setSel(null);
      return;
    }
    const text = selection.toString().replace(/\s+/g, " ").trim();
    if (!text) {
      setSel(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!wrap.contains(range.commonAncestorContainer)) return;
    const rect = range.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    setSel({
      quote:
        text.length > MAX_QUOTE_CHARS
          ? `${text.slice(0, MAX_QUOTE_CHARS - 1)}…`
          : text,
      top: rect.bottom - wrapRect.top + 6,
      left: Math.min(
        Math.max(rect.left - wrapRect.left, 0),
        Math.max(wrapRect.width - 440, 0),
      ),
    });
  }, [phase.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  const send = useCallback(
    async (note: string) => {
      if (!sel) return;
      setPhase({ kind: "sending" });
      try {
        const res = await fetch("/api/annotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, quote: sel.quote, note }),
        });
        const payload = (await res.json()) as
          | { ok: true; conversationId?: string; invocationId?: string; receipt: string }
          | { ok: false; error: string };
        if (!payload.ok) throw new Error(payload.error);
        setPhase({ kind: "sent", receipt: payload });
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "send failed",
        });
      }
    },
    [path, sel],
  );

  return (
    <div ref={wrapRef} className="relative" onMouseUp={onMouseUp}>
      {children}

      {sel ? (
        <div
          className="absolute z-30"
          style={{ top: sel.top, left: sel.left, width: 440, maxWidth: "100%" }}
        >
          {phase.kind === "chip" ? (
            <button
              type="button"
              onClick={() => setPhase({ kind: "dock" })}
              className="rounded-full border border-studio-edge px-2.5 py-1 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink transition-colors hover:text-studio-ink"
              style={{ ...STEER_GLASS_PANEL, color: "var(--scout-accent)" }}
            >
              Annotate
            </button>
          ) : (
            <div
              className="rounded-lg border border-studio-edge p-2"
              style={STEER_GLASS_PANEL}
            >
              <blockquote className="mb-2 border-l-2 border-studio-edge pl-2 font-mono text-xs leading-snug text-studio-ink-faint">
                {sel.quote.length > 140
                  ? `${sel.quote.slice(0, 139)}…`
                  : sel.quote}
              </blockquote>

              {phase.kind === "dock" ? (
                <InputDock
                  inline
                  evt={ANNOTATE_EVENT}
                  action={ANNOTATE_ACTION}
                  color="var(--scout-accent)"
                  keyframeId={keyframeId}
                  onSend={(text) => void send(text)}
                  onCancel={clear}
                />
              ) : phase.kind === "sending" ? (
                <div className="px-1 py-0.5 font-mono text-xs text-studio-ink-faint">
                  dispatching to the broker…
                </div>
              ) : phase.kind === "sent" ? (
                <ReceiptPanel receipt={phase.receipt} onDone={clear} />
              ) : (
                <div className="px-1 py-0.5 font-mono text-xs">
                  <span style={{ color: "var(--status-error-fg)" }}>
                    {phase.message}
                  </span>
                  <button
                    type="button"
                    onClick={clear}
                    className="ml-3 text-studio-ink-faint underline underline-offset-2 hover:text-studio-ink"
                  >
                    dismiss
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ReceiptPanel({
  receipt,
  onDone,
}: {
  receipt: Receipt;
  onDone: () => void;
}) {
  const conversationHref = receipt.conversationId
    ? `http://${window.location.hostname}:43120/messages/${receipt.conversationId}`
    : null;
  return (
    <div className="px-1 py-0.5 font-mono text-xs text-studio-ink">
      <span style={{ color: "var(--status-ok-fg)" }}>sent</span>
      {conversationHref ? (
        <a
          href={conversationHref}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-3 underline decoration-studio-edge underline-offset-2 hover:decoration-studio-ink"
        >
          open conversation →
        </a>
      ) : (
        <span className="ml-3 text-studio-ink-faint">{receipt.receipt}</span>
      )}
      <button
        type="button"
        onClick={onDone}
        className="ml-3 text-studio-ink-faint underline underline-offset-2 hover:text-studio-ink"
      >
        done
      </button>
    </div>
  );
}
