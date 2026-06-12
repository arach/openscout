"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Download, X } from "lucide-react";
import {
  trackCtaClick,
  trackFormError,
  trackIntentModalOpen,
  trackLeadGenerated,
} from "@/lib/analytics";

type SubmissionStatus = "idle" | "sending" | "success" | "error";

const OPENSCOUT_API_BASE_URL = (
  process.env.NEXT_PUBLIC_OPENSCOUT_API_BASE_URL?.trim()
  || process.env.NEXT_PUBLIC_OPENSCOUT_FEEDBACK_BASE_URL?.trim()
  || "https://api.openscout.app"
).replace(/\/$/, "");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const intentOptions = [
  { value: "", label: "What brings you here?" },
  { value: "manage-agents", label: "Managing AI agents from one place" },
  { value: "pairing", label: "Using Scout iOS to reach my agents" },
  { value: "multi-agent", label: "Running multiple agents together" },
  { value: "desktop", label: "A desktop app for Claude / Codex" },
  { value: "building", label: "Building on the runtime or API" },
  { value: "curious", label: "Just curious" },
] as const;

export function HeroIntentForm() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [intent, setIntent] = useState("");
  const [interest, setInterest] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<SubmissionStatus>("idle");
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && status !== "sending") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedInterest = interest.trim();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setStatus("error");
      setError("Please enter a valid email address.");
      trackFormError({
        errorType: "invalid_email",
        intent,
        location: "hero",
      });
      return;
    }

    setStatus("sending");
    setError("");

    try {
      const response = await fetch(`${OPENSCOUT_API_BASE_URL}/api/intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: normalizedEmail,
          intent: intent || undefined,
          interest: interest.trim() || undefined,
          source: "landing-hero",
          honeypot,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) {
        setStatus("error");
        setError(payload?.error ?? "Something went wrong. Please try again.");
        trackFormError({
          errorType: "server_error",
          intent,
          location: "hero",
        });
        return;
      }

      trackLeadGenerated({
        hasInterest: Boolean(trimmedInterest),
        intent,
        location: "hero",
      });
      setStatus("success");
      setEmail("");
      setIntent("");
      setInterest("");
      setHoneypot("");
    } catch {
      setStatus("error");
      setError("Network error. Please try again.");
      trackFormError({
        errorType: "network_error",
        intent,
        location: "hero",
      });
    }
  }

  function openModal() {
    trackCtaClick({
      ctaType: "early_access",
      destination: "intent_form",
      label: "Request early access",
      location: "hero",
    });
    trackIntentModalOpen("hero");
    setOpen(true);
  }

  function closeModal() {
    if (status === "sending") {
      return;
    }
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium shadow-sm transition-all hover:shadow ${
          status === "success"
            ? "bg-[var(--site-accent-soft)] text-[var(--site-accent)]"
            : "bg-[var(--site-ink)] text-[var(--site-ink-contrast)] hover:bg-[var(--site-ink-hover)]"
        }`}
      >
        {status === "success" ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
        <span>{status === "success" ? "You’re on the list" : "Request early access"}</span>
      </button>

      {open ? createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--site-overlay)] p-4 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Request Scout access"
          onClick={closeModal}
        >
          <div
            className="landing-panel relative w-full max-w-3xl overflow-hidden rounded-[28px]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeModal}
              className="absolute right-4 top-4 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--site-border)] bg-[var(--site-surface)] text-[var(--site-ink)] transition-colors hover:bg-[var(--site-surface-strong)]"
              aria-label="Close intent form"
            >
              <X className="h-5 w-5" />
            </button>

            {status === "success" ? (
              <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:p-10">
                <div className="rounded-2xl bg-[var(--site-accent-soft)] p-6 text-[var(--site-accent)]">
                  <div className="landing-label text-[var(--site-accent)]">Captured</div>
                  <div className="mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-white/80">
                    <Check className="h-6 w-6" />
                  </div>
                </div>
                <div className="flex min-h-[16rem] flex-col justify-center">
                  <h2 className="text-2xl font-semibold tracking-tight text-[var(--site-ink)] sm:text-3xl">
                    You&apos;re on the list.
                  </h2>
                  <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--site-copy)]">
                    I&apos;ll follow up when the Mac app is ready and use your note to understand whether you care most about the desktop app, Scout iOS, or both.
                  </p>
                  <div className="mt-6">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="inline-flex h-11 items-center rounded-lg bg-[var(--site-ink)] px-5 text-sm font-medium text-[var(--site-ink-contrast)] transition-colors hover:bg-[var(--site-ink-hover)]"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 sm:p-8 lg:p-10">
                <div className="max-w-2xl">
                  <h2 className="text-2xl font-semibold tracking-tight text-[var(--site-ink)] sm:text-3xl">
                    Install Scout for Mac
                  </h2>
                  <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--site-copy)]">
                    The same broker backs the desktop shell and Scout iOS, so one install on the Mac is enough to join the same human-and-agent system.
                  </p>
                </div>

                <form onSubmit={handleSubmit} className="mt-6 grid max-w-2xl content-start gap-4">
                  <label className="grid gap-1.5">
                    <span className="landing-label text-[var(--site-muted)]">Email</span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@email.com"
                      className="h-12 rounded-xl border border-[var(--site-border)] bg-[var(--site-surface-strong)] px-4 text-sm text-[var(--site-ink)] outline-none transition-colors placeholder:text-[var(--site-muted-soft)] focus:border-[var(--site-accent)]"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className="landing-label text-[var(--site-muted)]">Intent</span>
                      <div className="relative">
                        <select
                          value={intent}
                          onChange={(event) => setIntent(event.target.value)}
                          className="h-12 w-full appearance-none rounded-xl border border-[var(--site-border)] bg-[var(--site-surface-strong)] px-4 pr-10 text-sm text-[var(--site-ink)] outline-none transition-colors focus:border-[var(--site-accent)]"
                        >
                          {intentOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--site-muted-soft)]" />
                      </div>
                    </label>

                    <label className="grid gap-1.5">
                      <span className="landing-label text-[var(--site-muted)]">Interest</span>
                      <input
                        type="text"
                        value={interest}
                        onChange={(event) => setInterest(event.target.value)}
                        placeholder="Agent routing, Scout iOS, runtime..."
                        className="h-12 rounded-xl border border-[var(--site-border)] bg-[var(--site-surface-strong)] px-4 text-sm text-[var(--site-ink)] outline-none transition-colors placeholder:text-[var(--site-muted-soft)] focus:border-[var(--site-accent)]"
                      />
                    </label>
                  </div>

                  <input
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                    className="absolute -left-[9999px]"
                    aria-hidden="true"
                  />

                  <button
                    type="submit"
                    disabled={status === "sending"}
                    className="inline-flex h-12 items-center justify-center rounded-xl bg-[var(--site-ink)] px-5 text-sm font-medium text-[var(--site-ink-contrast)] transition-colors hover:bg-[var(--site-ink-hover)] disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {status === "sending" ? "Saving..." : "Request access"}
                  </button>

                  {error ? (
                    <p className="text-sm text-[var(--site-danger)]">{error}</p>
                  ) : null}

                  <p className="text-[12px] leading-relaxed text-[var(--site-muted)]">
                    Only used to follow up about Scout.
                  </p>
                </form>
              </div>
            )}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
