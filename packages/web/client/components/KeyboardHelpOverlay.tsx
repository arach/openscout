import { useEffect, useState } from "react";
import { useFocusTrap } from "../lib/keyboard-nav.ts";
import "./keyboard-help.css";

type Binding = { keys: string[]; label: string };
type Group = { title: string; bindings: Binding[] };

const GROUPS: Group[] = [
  {
    title: "Global",
    bindings: [
      { keys: ["?"], label: "Toggle this help" },
      { keys: ["Esc"], label: "Close dialog / clear search" },
      { keys: ["Tab", "⇧ Tab"], label: "Move focus" },
      { keys: ["["], label: "Focus previous pane" },
      { keys: ["]"], label: "Focus next pane" },
    ],
  },
  {
    title: "Lists",
    bindings: [
      { keys: ["↓", "j"], label: "Next item" },
      { keys: ["↑", "k"], label: "Previous item" },
      { keys: ["g", "Home"], label: "First item" },
      { keys: ["G", "End"], label: "Last item" },
      { keys: ["Enter"], label: "Open / activate" },
    ],
  },
  {
    title: "Search",
    bindings: [
      { keys: ["/"], label: "Focus filter input" },
      { keys: ["↓"], label: "From filter → first match" },
      { keys: ["Esc"], label: "Clear filter (while focused)" },
    ],
  },
  {
    title: "Tail · Atop",
    bindings: [
      { keys: ["/"], label: "Open filter (Tail)" },
      { keys: ["G"], label: "Jump to live (Tail)" },
      { keys: ["j", "k"], label: "Walk rows (Atop)" },
    ],
  },
  {
    title: "Session scrubber",
    bindings: [
      { keys: ["←", "→"], label: "Seek ±1%" },
      { keys: ["⇧ ←", "⇧ →"], label: "Seek ±5%" },
      { keys: ["Home", "End"], label: "Jump to start / end" },
    ],
  },
];

export function KeyboardHelpOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <div className="kb-help-backdrop" onClick={onClose} role="presentation">
      <div
        ref={ref}
        className="kb-help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kb-help-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        tabIndex={-1}
      >
        <header className="kb-help-head">
          <h2 id="kb-help-title" className="kb-help-title">Keyboard shortcuts</h2>
          <button
            type="button"
            className="kb-help-close"
            onClick={onClose}
            aria-label="Close (Esc)"
          >
            ✕
          </button>
        </header>
        <div className="kb-help-grid">
          {GROUPS.map((g) => (
            <section key={g.title} className="kb-help-group">
              <h3 className="kb-help-group-title">{g.title}</h3>
              <dl className="kb-help-list">
                {g.bindings.map((b, i) => (
                  <div key={`${g.title}-${i}`} className="kb-help-row">
                    <dt className="kb-help-keys">
                      {b.keys.map((k, ki) => (
                        <span key={ki}>
                          {ki > 0 && <span className="kb-help-or">or</span>}
                          <kbd className="kb-help-kbd">{k}</kbd>
                        </span>
                      ))}
                    </dt>
                    <dd className="kb-help-label">{b.label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer className="kb-help-foot">
          Press <kbd className="kb-help-kbd">?</kbd> to toggle · <kbd className="kb-help-kbd">Esc</kbd> to close
        </footer>
      </div>
    </div>
  );
}

export function useKeyboardHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key !== "?") return;
      const target = e.target as HTMLElement | null;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);
      if (inEditable) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, setOpen };
}
