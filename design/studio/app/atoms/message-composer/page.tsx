/**
 * MessageComposer atom gallery — sandwich layout contract.
 *
 *   header (reply) → input → toolbar [attach ··· model · mic · Send]
 *
 * Production: packages/web/client/components/MessageComposer/
 * Studio:     design/studio/components/MessageComposer.tsx
 */

"use client";

import { useState, type ReactNode } from "react";
import {
  MessageComposer,
  MessageComposerSelect,
} from "@/components/MessageComposer";

export default function MessageComposerAtomPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · atoms · message-composer
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          MessageComposer
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Sandwich layout: decoration on top, message in the middle, button-y
          controls on the base.{" "}
          <strong className="font-medium text-studio-ink">Send</strong> is an
          upright arrow and always commits the draft.{" "}
          <strong className="font-medium text-studio-ink">Mic</strong> only
          starts/stops recording. While live, a full-width{" "}
          <strong className="font-medium text-studio-ink">waveform</strong>{" "}
          sits in the body so model pickers stay clean in the toolbar.
        </p>
      </header>

      <ContractStrip />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Panel title="Canonical · attach + model + mic + Send">
          <InteractiveCanonical />
        </Panel>

        <Panel title="Reply annotation on top">
          <InteractiveWithHeader />
        </Panel>

        <Panel title="Voice flow · speech-shaped waveform (try mic)">
          <InteractiveVoice />
        </Panel>

        <Panel title="Agent stop mode (Send slot becomes Stop)">
          <MessageComposer
            defaultValue="Keep going on the sidebar polish…"
            showAttach
            stopMode
            onStop={() => undefined}
            tools={
              <MessageComposerSelect
                label="Model"
                value="sonnet"
                onChange={() => undefined}
                options={[
                  { value: "sonnet", label: "sonnet" },
                  { value: "opus", label: "opus" },
                ]}
              />
            }
          />
        </Panel>

        <Panel title="Compact density">
          <MessageComposer
            defaultValue=""
            placeholder="Quick note…"
            density="compact"
            showAttach
          />
        </Panel>

        <Panel title="Sending">
          <MessageComposer
            value="Routing to Action…"
            sending
            canSend={false}
            showAttach
            tools={
              <MessageComposerSelect
                label="Harness"
                value="claude"
                onChange={() => undefined}
                options={[{ value: "claude", label: "claude" }]}
              />
            }
          />
        </Panel>

        <Panel title="No dictation">
          <MessageComposer
            defaultValue="No mic in this surface."
            showDictation={false}
            showAttach
          />
        </Panel>

        <Panel title="Thread density (conversation footer)">
          <div className="rounded-md border border-studio-edge bg-studio-canvas">
            <div className="px-4 py-8 text-center font-mono text-[11px] text-studio-ink-faint">
              · transcript ·
            </div>
            <MessageComposer
              defaultValue=""
              placeholder="Message Action…"
              density="thread"
              showAttach
              tools={
                <span className="font-mono text-[10px] text-studio-ink-faint">
                  / commands · @ agents
                </span>
              }
            />
          </div>
        </Panel>
      </div>

      <div className="mt-12 grid max-w-4xl gap-8 border-t border-studio-edge pt-6 md:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            · props
          </div>
          <pre className="overflow-x-auto font-mono text-[11.5px] leading-relaxed text-studio-ink">
{`type Props = {
  value / onChange / onSend
  header?                 // top: reply annotation
  tools?                  // right toolbar: model / harness (before mic/Send)
  showAttach? / onAttach?
  showDictation?
  stopMode? / onStop?     // agent stop (not mic)
  density?: panel|thread|compact|bare
}`}
          </pre>
        </div>
        <div>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            · behavior
          </div>
          <ul className="space-y-2 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            <li>
              <strong className="text-studio-ink">Mic</strong> — start or stop
              recording. Live = speech-shaped waveform in the body (mic RMS or
              partial-driven energy — not a looping decoration).
            </li>
            <li>
              <strong className="text-studio-ink">Send</strong> — upright arrow;
              always commits the draft (⌘↵). Never controls the mic.
            </li>
            <li>
              Stop recording → transcript in the field → edit → Send. Or Send
              whenever the draft already says what you mean.
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}

function ContractStrip() {
  return (
    <div className="grid gap-2 rounded-md border border-studio-edge bg-studio-surface p-4 font-mono text-[11px] text-studio-ink-faint sm:grid-cols-3">
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
          Top
        </div>
        <div className="mt-1">header · reply annotation</div>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
          Middle
        </div>
        <div className="mt-1">input · waveform while recording</div>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.14em] text-studio-ink">
          Base
        </div>
        <div className="mt-1">attach left · model+mic+Send flush right</div>
      </div>
    </div>
  );
}

function InteractiveCanonical() {
  const [value, setValue] = useState("");
  const [harness, setHarness] = useState("claude");
  const [model, setModel] = useState("");
  const [last, setLast] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <MessageComposer
        value={value}
        onChange={setValue}
        onSend={(text) => {
          setLast(text);
          setValue("");
        }}
        showAttach
        onAttach={() => setLast("(attach tapped)")}
        tools={
          <>
            <MessageComposerSelect
              label="Harness"
              value={harness}
              onChange={setHarness}
              options={[
                { value: "claude", label: "claude" },
                { value: "codex", label: "codex" },
                { value: "pi", label: "pi" },
              ]}
            />
            <MessageComposerSelect
              label="Model"
              value={model}
              onChange={setModel}
              options={[
                { value: "", label: "default" },
                { value: "opus", label: "opus" },
                { value: "sonnet", label: "sonnet" },
              ]}
            />
          </>
        }
      />
      {last ? (
        <div className="font-mono text-[11px] text-studio-ink-faint">
          last → <span className="text-studio-ink">{last}</span>
        </div>
      ) : null}
    </div>
  );
}

function InteractiveWithHeader() {
  const [value, setValue] = useState("");
  return (
    <MessageComposer
      value={value}
      onChange={setValue}
      onSend={() => setValue("")}
      showAttach
      placeholder="Write a reply…"
      tools={
        <MessageComposerSelect
          label="Model"
          value=""
          onChange={() => undefined}
          options={[{ value: "", label: "default" }]}
        />
      }
      header={
        <div className="flex items-center gap-2 font-sans text-[12px] text-studio-ink-faint">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-400">
            Reply
          </span>
          <span className="truncate">
            Action — “shell padding is still off by 4px…”
          </span>
          <button
            type="button"
            className="ml-auto text-studio-ink-faint hover:text-studio-ink"
            aria-label="Clear reply"
          >
            ×
          </button>
        </div>
      }
    />
  );
}

function InteractiveVoice() {
  const [value, setValue] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const phrase =
    "the quiet start message bar needs a speech shaped waveform not a looping decoration";
  return (
    <div className="space-y-2">
      <MessageComposer
        value={value}
        onChange={setValue}
        onSend={(text) => {
          setLast(text);
          setValue("");
        }}
        showAttach
        demoUtterance={phrase}
        placeholder="Hit mic — bars track the phrase, not a CSS loop"
      />
      <p className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
        Studio speaks a real line. Bar heights follow vowel/pause energy along
        that utterance (and the caption reveals the words). Production uses
        live mic RMS when the browser has a stream, or the same speech-proxy
        idea from partials when native dictation has no analyser.
      </p>
      {last ? (
        <div className="font-mono text-[11px] text-studio-ink-faint">
          sent → <span className="text-studio-ink">{last}</span>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        · {title}
      </div>
      <div className="rounded-md border border-studio-edge bg-studio-canvas p-4">
        {children}
      </div>
    </div>
  );
}
