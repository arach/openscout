/**
 * MessageComposer atom gallery — the prop contract's living documentation.
 *
 *   header (reply) → input → toolbar [attach ··· model · mic · Send]
 *
 * Every panel is labelled with the EXACT param combination that produces it,
 * because that list is the spec the ports mirror. If a surface needs a shape
 * this page cannot express in params, the contract is missing a param — not
 * the surface a wrapper.
 *
 * Production: packages/web/client/components/MessageComposer/
 * Studio:     design/studio/components/MessageComposer.tsx
 * Phone:      design/studio/components/scout-ios/composer.tsx (defaults only)
 */

"use client";

import { useState, type ReactNode } from "react";
import {
  MessageComposer,
  MessageComposerSelect,
} from "@/components/MessageComposer";
import { StudyHeader } from "@/components/StudyHeader";

export default function MessageComposerAtomPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="atoms · message-composer" title="MessageComposer">
        Sandwich layout: decoration on top, message in the middle, button-y
        controls on the base.{" "}
        <strong className="font-medium text-studio-ink">Send</strong> is an
        upright arrow and always commits the draft.{" "}
        <strong className="font-medium text-studio-ink">Mic</strong> only
        starts/stops recording. While live, a full-width{" "}
        <strong className="font-medium text-studio-ink">waveform</strong>{" "}
        sits in the body so model pickers stay clean in the toolbar. One
        interface everywhere — web, the iOS kit, and the SwiftUI port — so each
        panel below is labelled with the params that produce it.
      </StudyHeader>

      <ContractStrip />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Panel
          title="Canonical · attach + harness/model + mic + Send"
          params="value · onChange · onSend · showAttach · onAttach · tools={2 × Select}"
        >
          <InteractiveCanonical />
        </Panel>

        <Panel
          title="Reply annotation on top"
          params="header · tools={Select} · showAttach · placeholder"
        >
          <InteractiveWithHeader />
        </Panel>

        <Panel
          title="Voice flow · speech-shaped waveform (try mic)"
          params="showAttach · demoUtterance · placeholder"
        >
          <InteractiveVoice />
        </Panel>

        <Panel
          title="Agent stop mode (Send slot becomes Stop)"
          params="defaultValue · showAttach · stopMode · onStop · tools={Select}"
        >
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

        <Panel
          title="Compact density"
          params={`density="compact" · placeholder · showAttach`}
        >
          <MessageComposer
            defaultValue=""
            placeholder="Quick note…"
            density="compact"
            showAttach
          />
        </Panel>

        <Panel
          title="Pill · folded (the phone ask box)"
          params={`appearance="pill" · rows={1} — no attach, no tools → one ~44px line`}
        >
          <MessageComposer appearance="pill" rows={1} placeholder="Ask the fleet…" />
        </Panel>

        <Panel
          title="Pill · runtime chips (harness · model · effort)"
          params={`appearance="pill" · rows={1} · showAttach · tools={3 × Select size="sm"}`}
        >
          <MessageComposer
            appearance="pill"
            rows={1}
            placeholder="Ask the fleet…"
            showAttach
            tools={<RuntimeTriplet />}
          />
        </Panel>

        <Panel
          title="Sending"
          params="value · sending · canSend={false} · showAttach · tools={Select}"
        >
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

        <Panel
          title="No dictation"
          params="defaultValue · showDictation={false} · showAttach"
        >
          <MessageComposer
            defaultValue="No mic in this surface."
            showDictation={false}
            showAttach
          />
        </Panel>

        <Panel
          title="Thread density (conversation footer)"
          params={`density="thread" · placeholder · showAttach · tools`}
        >
          <div className="rounded-md border border-studio-edge bg-studio-canvas">
            <div className="px-4 py-8 text-center font-mono text-sm text-studio-ink-faint">
              · transcript ·
            </div>
            <MessageComposer
              defaultValue=""
              placeholder="Message Action…"
              density="thread"
              showAttach
              tools={
                <span className="font-mono text-xs text-studio-ink-faint">
                  / commands · @ agents
                </span>
              }
            />
          </div>
        </Panel>
      </div>

      <div className="mt-12 grid max-w-4xl gap-8 border-t border-studio-edge pt-6 md:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
            · the contract
          </div>
          <pre className="overflow-x-auto font-mono text-sm leading-relaxed text-studio-ink">
{`// draft            Swift
value?             String
defaultValue?      String     // non-empty = armed
placeholder?       String
rows?              Int
autoFocus?         Bool
onChange?          (String) -> Void

// commit
onSend?            (String) -> Void
canSend?           Bool       // override the derived rule
sending? disabled? Bool
stopMode? onStop?  Bool / () -> Void

// toolbar
showAttach? onAttach?
showDictation?     Bool
header?  tools?    @ViewBuilder

// presentation
density?           enum panel | thread | compact
appearance?        enum panel | pill
className?         web only — the port drops it`}
          </pre>
          <p className="mt-3 font-sans text-md leading-relaxed text-studio-ink-faint">
            No <code className="font-mono">armed</code> or{" "}
            <code className="font-mono">focused</code> prop, by design: state
            derives from the draft and from real focus, so a study can never
            pin a look the shipped component would not produce.
          </p>
        </div>
        <div>
          <div className="mb-2 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
            · behavior
          </div>
          <ul className="space-y-2 font-sans text-lg leading-relaxed text-studio-ink-faint">
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

/** The phone's toolbar set — what `components/scout-ios/composer.tsx` passes
 *  as `tools`. Value-only, `sm`, so three of them fit beside attach/mic/Send. */
function RuntimeTriplet() {
  return (
    <>
      <MessageComposerSelect
        label="Harness" size="sm" value="claude" onChange={() => undefined}
        options={[{ value: "claude", label: "claude" }, { value: "codex", label: "codex" }]}
      />
      <MessageComposerSelect
        label="Model" size="sm" value="opus-4.8" onChange={() => undefined}
        options={[{ value: "opus-4.8", label: "opus-4.8" }, { value: "sonnet-4.8", label: "sonnet-4.8" }]}
      />
      <MessageComposerSelect
        label="Effort" size="sm" value="high" onChange={() => undefined}
        options={[{ value: "high", label: "high" }, { value: "low", label: "low" }]}
      />
    </>
  );
}

function ContractStrip() {
  return (
    <div className="grid gap-2 rounded-md border border-studio-edge bg-studio-surface p-4 font-mono text-sm text-studio-ink-faint sm:grid-cols-3">
      <div>
        <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-studio-ink">
          Top
        </div>
        <div className="mt-1">header · reply annotation</div>
      </div>
      <div>
        <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-studio-ink">
          Middle
        </div>
        <div className="mt-1">input · waveform while recording</div>
      </div>
      <div>
        <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-studio-ink">
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
        <div className="font-mono text-sm text-studio-ink-faint">
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
        <div className="flex items-center gap-2 font-sans text-md text-studio-ink-faint">
          <span className="font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-emerald-400">
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
      <p className="font-sans text-md leading-relaxed text-studio-ink-faint">
        Studio speaks a real line. Bar heights follow vowel/pause energy along
        that utterance (and the caption reveals the words). Production uses
        live mic RMS when the browser has a stream, or the same speech-proxy
        idea from partials when native dictation has no analyser.
      </p>
      {last ? (
        <div className="font-mono text-sm text-studio-ink-faint">
          sent → <span className="text-studio-ink">{last}</span>
        </div>
      ) : null}
    </div>
  );
}

/** One demonstrated variant. `params` is the exact combination that produces
 *  it — the page is the contract's documentation, so it has to be literal. */
function Panel({
  title,
  params,
  children,
}: {
  title: string;
  params: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
        · {title}
      </div>
      <div className="mb-2 mt-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-studio-ink-muted">
        {params}
      </div>
      <div className="rounded-md border border-studio-edge bg-studio-canvas p-4">
        {children}
      </div>
    </div>
  );
}
