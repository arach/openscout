"use client";

import { useState } from "react";
import Link from "next/link";
import { StudyHeader } from "@/components/StudyHeader";
import { MessageComposer } from "@/components/MessageComposer";
import "@/components/runtime-picker.css";
import {
  RuntimePicker,
  SCOUT_RUNTIME_CATALOG,
  type RuntimeCatalog,
  type RuntimeValue,
} from "@/components/RuntimePicker";
import { runtimePickerManifest as manifest } from "@/components/RuntimePicker.manifest";

/**
 * Atom page for RuntimePicker.
 *
 * The prose sections — props, states, keyboard, when-to-use — are rendered
 * from `RuntimePicker.manifest.ts` rather than written again here. A page that
 * restates its manifest starts disagreeing with it within a week, and the
 * manifest is the artifact the main project and its agents actually read.
 * Everything below is either a live specimen or a projection of the manifest.
 */

/** A deliberately long list, to exercise the filter that `"auto"` turns on. */
const WIDE_CATALOG: RuntimeCatalog = {
  ...SCOUT_RUNTIME_CATALOG,
  harnesses: SCOUT_RUNTIME_CATALOG.harnesses.map((harness) =>
    harness.value === "claude"
      ? {
          ...harness,
          models: [
            ...harness.models,
            { value: "claude-fable-5", label: "Fable 5", note: "narrative" },
            { value: "claude-opus-4-8", label: "Opus 4.8" },
            { value: "claude-opus-4-7", label: "Opus 4.7" },
            { value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
            { value: "claude-haiku-4-0", label: "Haiku 4" },
          ],
        }
      : harness,
  ),
};

export default function RuntimePickerPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <StudyHeader eyebrow="atoms · web · runtime-picker" title="Runtime picker">
        {manifest.summary} At rest the harness is a mark rather than a word, so
        the chip is a glyph, a model and a level. Data lives in a catalog, not in
        the component, which is what makes it droppable into a surface that has
        real harnesses on hand.
      </StudyHeader>

      <ManifestBar />

      <Section
        title="Drop-in"
        hint="No props. Uncontrolled, fixture catalog, working panel. This is the entire adoption cost — everything below is opt-in."
      >
        <div className="flex flex-wrap items-center gap-5">
          <RuntimePicker />
          <Code block>{manifest.examples[0].code}</Code>
        </div>
      </Section>

      <Section
        title="Rail"
        hint="The real MessageComposer, picker in the tools slot — right cluster, before mic and Send. Harness as a left rail with one travelling marker; models beside it; effort as a footer ladder. Console-dense."
      >
        <Wired variant="rail" seed={{ harness: "claude", model: "claude-opus-5" }} />
      </Section>

      <Section
        title="Bands"
        hint="Same slot, same trigger. Three labelled bands, larger targets, more air — reads as a small settings sheet rather than a menu."
      >
        <Wired variant="bands" seed={{ harness: "codex", model: "gpt-5.5-codex" }} />
      </Section>

      <Section
        title="Catalog states"
        hint="A live catalog arrives over the wire, so it can be late, absent or wrong. All three are the same component under different props — no caller branches on them."
      >
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <Specimen label="loading" caption='status="loading"'>
            <RuntimePicker status="loading" />
          </Specimen>
          <Specimen label="error" caption="status + onRetry">
            <RuntimePicker
              status="error"
              statusMessage="Could not reach the runner."
              onRetry={() => {}}
            />
          </Specimen>
          <Specimen label="disabled" caption="disabled">
            <RuntimePicker disabled />
          </Specimen>
        </div>
      </Section>

      <Section
        title="Catalog truths the picker has to carry"
        hint="Each of these is a fact about real runtimes, expressed as data rather than as a branch inside the component."
      >
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <Specimen label="no effort transport" caption="Grok — the band is replaced, not hidden">
            <RuntimePicker defaultValue={{ harness: "grok", model: "grok-4.5" }} />
          </Specimen>
          <Specimen label="custom model" caption="free text the catalog has never seen">
            <RuntimePicker
              defaultValue={{ harness: "claude", model: "claude-opus-5-20991231" }}
            />
          </Specimen>
          <Specimen label="filter" caption='searchable="auto" past six models'>
            <RuntimePicker catalog={WIDE_CATALOG} />
          </Specimen>
          <Specimen label="phone density" caption='size="sm"'>
            <RuntimePicker size="sm" variant="bands" />
          </Specimen>
        </div>
        <p className="mt-4 max-w-prose text-md leading-relaxed text-studio-ink-muted">
          Open the rail and arrow onto <em>Gemini</em>: it is listed, it is
          reachable, and it declines. An uninstalled harness is information, so
          it stays visible and stays announced rather than being dropped from the
          list.
        </p>
      </Section>

      <Section
        title="Keyboard"
        hint="Manual activation, not selection-follows-focus. Arrows move the cursor and Enter commits — choosing a harness resets the model, so arrowing past one must not discard it."
      >
        <table className="w-full max-w-[640px] border-collapse text-md">
          <tbody>
            {(manifest.keyboard ?? []).map((binding) => (
              <tr key={`${binding.keys}-${binding.scope ?? ""}`} className="border-b border-studio-edge">
                <td className="w-[150px] py-1.5 pr-4 align-top font-mono text-sm text-studio-ink">
                  {binding.keys}
                </td>
                <td className="py-1.5 pr-4 align-top text-studio-ink-muted">
                  {binding.action}
                </td>
                <td className="w-[80px] py-1.5 text-right align-top text-2xs uppercase tracking-caps text-studio-ink-faint">
                  {binding.scope ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Props" hint="Projected from the manifest — this table cannot drift from it.">
        <table className="w-full max-w-[900px] border-collapse text-md">
          <thead>
            <tr className="border-b border-studio-edge-strong text-left">
              <Th>prop</Th>
              <Th>type</Th>
              <Th>default</Th>
              <Th>notes</Th>
            </tr>
          </thead>
          <tbody>
            {manifest.props.map((prop) => (
              <tr key={prop.name} className="border-b border-studio-edge align-top">
                <td className="py-1.5 pr-4 font-mono text-sm text-studio-ink">{prop.name}</td>
                <td className="py-1.5 pr-4 font-mono text-sm text-studio-ink-faint">
                  {prop.type}
                </td>
                <td className="py-1.5 pr-4 font-mono text-sm text-studio-ink-faint">
                  {prop.default ?? "—"}
                </td>
                <td className="py-1.5 text-studio-ink-muted">{prop.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="States" hint="What a port gets wrong if nobody wrote it down.">
        <ul className="flex max-w-prose flex-col gap-2.5">
          {(manifest.states ?? []).map((state) => (
            <li key={state.name} className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-studio-ink-faint" />
              <span className="text-md leading-relaxed text-studio-ink-muted">
                <span className="font-medium text-studio-ink">{state.name}</span>{" "}
                <span className="font-mono text-sm text-studio-ink-faint">
                  ({state.trigger})
                </span>{" "}
                — {state.behavior}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Port drift"
        hint="There is already a copy of this in production, and the two have diverged. The manifest names every divergence so the next person to touch either side knows what they are walking into."
      >
        <p className="mb-3 font-mono text-sm text-studio-ink-faint">
          {manifest.port?.target} · <span className="text-studio-ink">{manifest.port?.status}</span>
        </p>
        <ul className="flex max-w-prose flex-col gap-2">
          {(manifest.port?.drift ?? []).map((line) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-scout-accent" />
              <span className="text-md leading-relaxed text-studio-ink-muted">{line}</span>
            </li>
          ))}
        </ul>
        {manifest.port?.notes ? (
          <p className="mt-4 max-w-prose text-md leading-relaxed text-studio-ink">
            {manifest.port.notes}
          </p>
        ) : null}
      </Section>
    </main>
  );
}

// ── Specimens ────────────────────────────────────────────────────────────────

function Wired({
  variant,
  seed,
}: {
  variant: "rail" | "bands";
  seed: Partial<RuntimeValue>;
}) {
  const [value, setValue] = useState<RuntimeValue>({
    harness: seed.harness ?? "claude",
    model: seed.model ?? "",
    effort: seed.effort ?? "medium",
  });
  return (
    <>
      <Bench>
        <MessageComposer
          defaultValue={
            variant === "rail"
              ? "Please review pull request #167 — add summonable phone control deck"
              : "Ship the type ladder pass, then re-run the parity audit."
          }
          showAttach
          tools={<RuntimePicker value={value} onChange={setValue} variant={variant} />}
        />
      </Bench>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-2xs uppercase tracking-caps text-studio-ink-faint">
        <Pair k="harness" v={value.harness} />
        <Pair k="model" v={value.model || "default"} />
        <Pair k="effort" v={value.effort || "n/a"} />
      </dl>
    </>
  );
}

function Specimen({
  label,
  caption,
  children,
}: {
  label: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      {children}
      <div className="font-mono text-sm text-studio-ink-faint">{caption}</div>
    </div>
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

// ── Page furniture ───────────────────────────────────────────────────────────

/** The manifest's own header: status, where it lives, how to get it. */
function ManifestBar() {
  return (
    <div className="mb-9 flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-studio-edge py-2.5">
      <span className="rounded-full bg-scout-accent-soft px-2 py-0.5 text-2xs font-semibold uppercase tracking-caps text-studio-ink">
        {manifest.status}
      </span>
      <span className="font-mono text-sm text-studio-ink-muted">
        {`import { RuntimePicker } from "${manifest.import.from}"`}
      </span>
      <span className="font-mono text-sm text-studio-ink-faint">
        bun run ds show {manifest.id}
      </span>
      <Link
        href="/system"
        className="ml-auto text-2xs uppercase tracking-caps text-scout-accent hover:underline"
      >
        design system ›
      </Link>
    </div>
  );
}

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
    <section className="mb-11">
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="py-1.5 pr-4 text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </th>
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

function Code({ children, block }: { children: React.ReactNode; block?: boolean }) {
  if (block) {
    return (
      <pre className="rounded-[4px] border border-studio-edge bg-studio-canvas-alt px-3 py-2 font-mono text-sm text-studio-ink">
        {children}
      </pre>
    );
  }
  return <code className="font-mono text-sm text-studio-ink">{children}</code>;
}
