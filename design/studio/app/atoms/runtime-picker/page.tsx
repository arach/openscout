"use client";

import { useState } from "react";
import { StudyHeader } from "@/components/StudyHeader";
import { MessageComposer } from "@/components/MessageComposer";
import "@/components/runtime-picker.css";
import {
  RuntimePicker,
  RUNTIME_EFFORTS,
  RUNTIME_HARNESSES,
  RUNTIME_MODELS,
  type RuntimeValue,
} from "@/components/RuntimePicker";

/**
 * Studio: RuntimePicker — harness · model · effort as one control.
 *
 * Donor is three separate controls: two `MessageComposerSelect` pills plus a
 * text input with a datalist in `PullRequestAssignDialog`. This study proposes
 * collapsing them and offers two panel treatments against the same trigger.
 */

const DEFAULT_VALUE: RuntimeValue = {
  harness: "claude",
  model: "opus",
  effort: "medium",
};

export default function RuntimePickerPage() {
  const [rail, setRail] = useState<RuntimeValue>(DEFAULT_VALUE);
  const [bands, setBands] = useState<RuntimeValue>({
    harness: "codex",
    model: "gpt-5.5",
    effort: "high",
  });

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="atoms · web · runtime-picker" title="Runtime picker">
        Harness, model and effort are three controls in the composer toolbar today
        — two select pills and a free-text model field. They say one thing between
        them: which runtime this message goes to. Collapsed, the harness is a mark
        rather than a word, so the resting state is a glyph, a model and a level.
        Two panel treatments below, same trigger.
      </StudyHeader>

      <Section
        title="Rail"
        hint="The real MessageComposer, picker in the tools slot — right cluster, before mic and Send. Harness as a left rail with one travelling marker; models beside it; effort as a footer ladder. Console-dense."
      >
        <Bench>
          <MessageComposer
            defaultValue="Please review pull request #167 — add summonable phone control deck"
            showAttach
            tools={<RuntimePicker value={rail} onChange={setRail} variant="rail" />}
          />
        </Bench>
        <Readout value={rail} />
      </Section>

      <Section
        title="Bands"
        hint="Same slot, same trigger. Three labelled bands, larger targets, more air — reads as a small settings sheet rather than a menu."
      >
        <Bench>
          <MessageComposer
            defaultValue="Ship the type ladder pass, then re-run the parity audit."
            showAttach
            tools={<RuntimePicker value={bands} onChange={setBands} variant="bands" />}
          />
        </Bench>
        <Readout value={bands} />
      </Section>

      <Section
        title="Effort is ordinal"
        hint="Low → XHigh is a ladder, not a list, so it gets a filling meter and a tone rather than a dropdown. The chip inherits the tone, which is why the level reads without being read."
      >
        <div className="flex flex-wrap gap-2">
          {RUNTIME_EFFORTS.map((effort) => (
            <ChipPreview key={effort.value} effort={effort.value} />
          ))}
        </div>
      </Section>

      <Section title="Notes" hint="What's real, and what a port has to carry.">
        <ul className="flex max-w-prose flex-col gap-2 text-md leading-relaxed text-studio-ink-muted">
          <Note>
            Harnesses and efforts are the real lists —{" "}
            <Code>PR_REVIEW_HARNESSES</Code> and <Code>PR_REVIEW_EFFORTS</Code> from{" "}
            <Code>pull-request-actions.ts</Code>.
          </Note>
          <Note>
            Models are curated per harness here. In production they come from{" "}
            <Code>modelOptionsForLaunch()</Code> — derived from the agents on hand —
            plus free text, so a port must keep <Code>&quot;&quot;</Code> meaning
            &ldquo;let the harness decide&rdquo; and keep an escape hatch for a model
            that isn&apos;t in the list.
          </Note>
          <Note>
            Upstream, the third harness is <Code>{'{ value: "pi", label: "Grok" }'}</Code>.
            That pairing renders the π glyph, not the Grok mark, because{" "}
            <Code>HarnessMark</Code> keys on the value. Either the value should be{" "}
            <Code>grok</Code> or the alias table needs a <Code>pi → grok</Code> entry —
            this study assumes the former.
          </Note>
          <Note>
            Changing harness resets model to Default rather than guessing a
            cross-vendor equivalent. Carrying <Code>opus</Code> over to Codex would be
            a silent lie.
          </Note>
        </ul>
      </Section>
    </main>
  );
}

// ── page furniture ───────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-9">
      <h2 className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {title}
      </h2>
      {hint ? (
        <p className="mt-1 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
          {hint}
        </p>
      ) : null}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

/** Composer bench — enough width to read as a real surface, and headroom below
 *  so an upward-opening panel has somewhere to go on the page. */
function Bench({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-[620px] rounded-[8px] border border-dashed border-studio-edge bg-studio-canvas-alt p-4">
      {children}
    </div>
  );
}

function Readout({ value }: { value: RuntimeValue }) {
  const models = RUNTIME_MODELS[value.harness] ?? [];
  const model = models.find((m) => m.value === value.model);
  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-2xs uppercase tracking-caps text-studio-ink-faint">
      <Pair k="harness" v={RUNTIME_HARNESSES.find((h) => h.value === value.harness)?.label} />
      <Pair k="model" v={model?.value ? model.label : "default"} />
      <Pair k="effort" v={value.effort} />
    </dl>
  );
}

function Pair({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{k}</dt>
      <dd className="font-semibold text-studio-ink">{v ?? "—"}</dd>
    </div>
  );
}

function ChipPreview({ effort }: { effort: string }) {
  const [value, setValue] = useState<RuntimeValue>({
    harness: "claude",
    model: "opus",
    effort,
  });
  return <RuntimePicker value={value} onChange={setValue} variant="rail" />;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-studio-ink-faint" />
      <span>{children}</span>
    </li>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-sm text-studio-ink">{children}</code>
  );
}
