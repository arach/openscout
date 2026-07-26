"use client";

import { Suspense, useCallback, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Focus mode — the studio's fullscreen-mock view.
 *
 * `?focus=1` has always stripped the chrome so a study can be screenshotted
 * or shown clean. Two things were wrong with it: nothing on screen said it
 * existed, and once you were inside there was no way back out except editing
 * the URL by hand. A capability you can only reach by reading the source is
 * not a capability.
 *
 * So: a key cap in the page strip that names the shortcut, `f` to toggle,
 * Escape to leave, and — inside focus mode — an exit that stays invisible at
 * rest and appears on hover or keyboard focus. Invisible at rest matters,
 * because the entire point of the mode is a clean frame to capture.
 */

const PARAM = "focus";

function useFocusToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const active = params.get(PARAM) === "1" || params.get(PARAM) === "true";

  const setFocus = useCallback(
    (next: boolean) => {
      const q = new URLSearchParams(params.toString());
      if (next) q.set(PARAM, "1");
      else q.delete(PARAM);
      const qs = q.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  return { active, setFocus };
}

/**
 * `f` toggles, Escape leaves. Guarded so it never eats a keystroke meant for
 * a field: any modifier, any editable target, or an in-flight IME composition
 * and we stay out of the way.
 */
function useFocusHotkeys(active: boolean, setFocus: (next: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.isComposing) return;

      const el = e.target as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          el.isContentEditable
        ) {
          return;
        }
      }

      if (e.key === "f") {
        e.preventDefault();
        setFocus(!active);
        return;
      }
      if (e.key === "Escape" && active) {
        e.preventDefault();
        setFocus(false);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, setFocus]);
}

/**
 * Both exports own their Suspense boundary. `useSearchParams` opts a subtree
 * out of static rendering unless it sits under one, and these mount inside
 * chrome that renders on every route — so the boundary lives here rather than
 * making every caller remember it.
 */
export function FocusToggle() {
  return (
    <Suspense fallback={null}>
      <FocusToggleInner />
    </Suspense>
  );
}

export function FocusExit() {
  return (
    <Suspense fallback={null}>
      <FocusExitInner />
    </Suspense>
  );
}

/** The key cap in the page strip. Names the shortcut rather than hiding it. */
function FocusToggleInner() {
  const { active, setFocus } = useFocusToggle();
  useFocusHotkeys(active, setFocus);

  return (
    <button
      type="button"
      onClick={() => setFocus(!active)}
      title="Fullscreen this study — hides the sidebar and page strip (f)"
      className={cn(
        "focus-ring group flex shrink-0 items-center gap-1.5 rounded-[3px] px-1.5 py-1",
        "text-studio-ink-faint transition-colors hover:text-studio-ink",
      )}
    >
      <span className="text-2xs uppercase tracking-eyebrow">Focus</span>
      <kbd
        aria-hidden
        className={cn(
          "grid h-[15px] min-w-[15px] place-items-center rounded-[2px] px-1",
          "border border-studio-edge bg-studio-canvas-alt",
          "font-mono text-2xs leading-none text-studio-ink-faint",
          "transition-colors group-hover:border-studio-edge-strong group-hover:text-studio-ink",
        )}
      >
        F
      </kbd>
    </button>
  );
}

/**
 * The way out. Transparent at rest so it never lands in a screenshot, and
 * fully visible the moment a pointer comes near or a keyboard reaches it.
 */
function FocusExitInner() {
  const { active, setFocus } = useFocusToggle();
  useFocusHotkeys(active, setFocus);

  if (!active) return null;

  return (
    <div className="fixed bottom-0 right-0 z-50 p-5 print:hidden">
      <button
        type="button"
        onClick={() => setFocus(false)}
        className={cn(
          "focus-ring flex items-center gap-2 rounded-[3px] px-2.5 py-1.5",
          // Opaque, not a translucent tint: this sits over arbitrary study
          // content, so it has to stay legible whatever is behind it. (An
          // opacity modifier would also be a no-op here — Tailwind cannot
          // alpha the studio's var()-backed oklch colours.)
          "border border-studio-edge bg-studio-canvas",
          "font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint",
          "opacity-0 transition-opacity duration-200",
          "hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        Exit focus
        <kbd
          aria-hidden
          className="grid h-[15px] place-items-center rounded-[2px] border border-studio-edge px-1 text-2xs leading-none"
        >
          ESC
        </kbd>
      </button>
    </div>
  );
}
