"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ScoutStudyShell } from "@/components/scout/ScoutStudyShell";
import styles from "./project-picker.module.css";

type Presentation = "message" | "finder";

type Project = {
  id: string;
  name: string;
  path: string;
  branch: string;
  host: string;
  lastOpened: string;
  recentRank: number;
  kind: "project" | "worktree";
};

const PROJECTS: Project[] = [
  { id: "openscout-main", name: "openscout", path: "~/dev/openscout", branch: "main", host: "air", lastOpened: "Just now", recentRank: 100, kind: "project" },
  { id: "talkie-main", name: "talkie", path: "~/dev/talkie", branch: "main", host: "air", lastOpened: "18 min", recentRank: 92, kind: "project" },
  { id: "lattices-main", name: "lattices", path: "~/dev/lattices", branch: "main", host: "air", lastOpened: "1 hr", recentRank: 86, kind: "project" },
  { id: "openscout-comms", name: "openscout", path: "~/dev/openscout-worktrees/comms", branch: "codex/comms-routing", host: "air", lastOpened: "3 hr", recentRank: 79, kind: "worktree" },
  { id: "hudson-main", name: "hudson", path: "~/dev/hudson", branch: "main", host: "air", lastOpened: "Yesterday", recentRank: 73, kind: "project" },
  { id: "studio-main", name: "studio", path: "~/dev/studio", branch: "main", host: "air", lastOpened: "Yesterday", recentRank: 67, kind: "project" },
  { id: "premotion-main", name: "premotion", path: "~/dev/premotion", branch: "main", host: "air", lastOpened: "3 days", recentRank: 58, kind: "project" },
  { id: "openscout-terminal", name: "openscout", path: "~/dev/openscout-worktrees/terminal-tabs", branch: "codex/terminal-tabs", host: "air", lastOpened: "4 days", recentRank: 51, kind: "worktree" },
  { id: "vox-main", name: "vox", path: "~/dev/vox", branch: "main", host: "air", lastOpened: "6 days", recentRank: 43, kind: "project" },
  { id: "arc-main", name: "arc", path: "~/dev/arc", branch: "main", host: "air", lastOpened: "1 week", recentRank: 35, kind: "project" },
  { id: "talkie-rewrite", name: "talkie", path: "~/dev/talkie-worktrees/swiftui-rewrite", branch: "swiftui-rewrite", host: "air", lastOpened: "2 weeks", recentRank: 26, kind: "worktree" },
  { id: "planning-hq", name: "planning-hq", path: "~/dev/planning-hq", branch: "main", host: "air", lastOpened: "2 weeks", recentRank: 18, kind: "project" },
];

function normalize(value: string) {
  return value.toLocaleLowerCase().replace(/[\s/_-]+/g, " ").trim();
}

function score(project: Project, rawQuery: string) {
  const query = normalize(rawQuery);
  if (!query) return project.recentRank;

  const terms = query.split(" ").filter(Boolean);
  const name = normalize(project.name);
  const path = normalize(project.path);
  const branch = normalize(project.branch);
  const haystack = `${name} ${path} ${branch} ${normalize(project.host)}`;

  if (!terms.every((term) => haystack.includes(term))) return -1;

  let result = project.recentRank / 100;
  if (name === query) result += 120;
  else if (name.startsWith(query)) result += 80;
  else if (name.includes(query)) result += 48;
  if (branch.startsWith(query)) result += 34;
  if (path.includes(query)) result += 20;
  result += terms.reduce((total, term) => total + (name.startsWith(term) ? 12 : 0), 0);
  return result;
}

function projectResults(query: string) {
  return PROJECTS
    .map((project) => ({ project, score: score(project, query) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.project);
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function FolderGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d={open ? "M3 9h18l-2 10H5L3 9Zm1-2V5h6l2 2h7v2" : "M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"} />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  );
}

function mark(value: string, query: string) {
  const terms = query.trim().split(/[\s/_-]+/).filter(Boolean);
  if (!terms.length) return value;
  const pattern = terms
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const parts = value.split(new RegExp(`(${pattern})`, "gi"));
  return parts.map((part, index) =>
    terms.some((term) => term.toLocaleLowerCase() === part.toLocaleLowerCase())
      ? <mark key={`${part}-${index}`}>{part}</mark>
      : part,
  );
}

function ProjectSearch({
  presentation,
  selected,
  open,
  onOpenChange,
  onSelect,
}: {
  presentation: Presentation;
  selected: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const instanceId = useId().replaceAll(":", "");
  const resultsId = `project-search-results-${instanceId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const allResults = useMemo(() => projectResults(query), [query]);
  const results = useMemo(
    () => allResults.slice(0, query.trim() ? 9 : 6),
    [allResults, query],
  );
  // Matched against the RAW query, not the trimmed one. The ghost overlay sits
  // directly behind the input, so its transparent prefix must be exactly what
  // was typed — and pressing → must produce exactly what the ghost showed.
  // Trimming here broke both: typing "open " rendered "open scout" with a gap,
  // then → collapsed it to "openscout". A query with stray whitespace is simply
  // not a prefix of any project, so it correctly offers no completion.
  const bestCompletion = useMemo(() => {
    if (!query.trim()) return "";
    const match = results.find((project) =>
      project.name.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
    );
    return match && match.name.length > query.length ? match.name : "";
  }, [query, results]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(handle);
  }, [open, presentation]);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    if (!open) return;
    function dismissOutside(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
      if (presentation === "message") {
        window.setTimeout(() => triggerRef.current?.focus(), 0);
      }
    }
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [onOpenChange, open, presentation]);

  function choose(project: Project) {
    onSelect(project);
    setQuery("");
    onOpenChange(false);
    if (presentation === "message") {
      window.setTimeout(() => triggerRef.current?.focus(), 0);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor((value) => Math.max(value - 1, 0));
    } else if (event.key === "Enter" && results[cursor]) {
      event.preventDefault();
      choose(results[cursor]);
    } else if (
      event.key === "ArrowRight" &&
      bestCompletion &&
      event.currentTarget.selectionStart === query.length
    ) {
      event.preventDefault();
      setQuery(bestCompletion);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      onOpenChange(false);
      if (presentation === "message") {
        window.setTimeout(() => triggerRef.current?.focus(), 0);
      }
    }
  }

  const searchSurface = (
    <div className={styles.searchSurface}>
      <div className={styles.searchBox}>
        <span className={styles.searchIcon}><SearchGlyph /></span>
        <div className={styles.inputStack}>
          {bestCompletion ? (
            <div className={styles.completion} aria-hidden>
              <span>{query}</span>{bestCompletion.slice(query.length)}
            </div>
          ) : null}
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => onOpenChange(true)}
            placeholder="Type a project name, path, or branch…"
            aria-label="Find a project"
            aria-controls={resultsId}
            aria-activedescendant={results[cursor] ? `${instanceId}-project-${results[cursor].id}` : undefined}
            aria-autocomplete="both"
            role="combobox"
            aria-expanded={presentation === "finder" || open}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {bestCompletion ? <kbd className={styles.completionHint}>→</kbd> : presentation === "finder" ? <kbd className={styles.shortcutHint}>⌘K</kbd> : null}
      </div>

      {/* The scroller holds the heading and the empty state; only the inner
       *  element is the listbox. A listbox may contain options and groups —
       *  a heading div and a recovery message are neither, and putting them
       *  inside made the option count wrong for assistive tech. */}
      <div className={styles.results}>
        <div className={styles.resultHeading}>
          {/* "Best matches" over an empty list is a promise the list does not
           *  keep; the heading has to agree with what is under it. */}
          <span>
            {!query.trim() ? "Recent" : results.length ? "Best matches" : "No matches"}
          </span>
          <span>
            {query.trim()
              ? allResults.length > results.length
                ? `${results.length} of ${allResults.length} shown`
                : `${allResults.length} found`
              : "ordered by last opened"}
          </span>
        </div>

        <div id={resultsId} role="listbox" aria-label="Projects">
          {results.map((project, index) => {
            const active = index === cursor;
            const isSelected = selected.id === project.id;
            return (
              <button
                key={project.id}
                id={`${instanceId}-project-${project.id}`}
                type="button"
                role="option"
                // `aria-selected` tracks the cursor — it is what Enter will
                // choose. The already-chosen project is `aria-current`, which
                // is what the check glyph draws. Conflating them made the
                // announced selection disagree with the visible highlight.
                aria-selected={active}
                aria-current={isSelected || undefined}
                tabIndex={-1}
                className={`${styles.projectRow} ${active ? styles.projectRowActive : ""}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(project)}
              >
                <span className={styles.folder}><FolderGlyph /></span>
                <span className={styles.projectIdentity}>
                  <span className={styles.projectLine}>
                    <strong>{mark(project.name, query)}</strong>
                    {project.kind === "worktree" ? <span className={styles.worktree}>worktree</span> : null}
                  </span>
                  <span className={styles.projectPath}>{mark(project.path, query)}</span>
                </span>
                <span className={styles.projectContext}>
                  <span>{mark(project.branch, query)}</span>
                  <small>{project.host} · {project.lastOpened}</small>
                </span>
                <span className={`${styles.rowCheck} ${isSelected ? styles.rowCheckVisible : ""}`}>
                  {isSelected ? <CheckGlyph /> : active ? <span>↵</span> : null}
                </span>
              </button>
            );
          })}
        </div>

        {results.length === 0 ? (
          <div className={styles.empty} role="status">
            <strong>No project matches “{query}”</strong>
            <span>Try a folder name, branch, or part of its path.</span>
          </div>
        ) : null}
      </div>

      <button type="button" className={styles.browseRow} onClick={() => folderInputRef.current?.click()}>
        <span className={styles.folder}><FolderGlyph open /></span>
        <span>Choose a folder…</span>
        <small>⌘O</small>
      </button>
      <input
        ref={folderInputRef}
        className={styles.folderInput}
        type="file"
        aria-hidden="true"
        tabIndex={-1}
        {...{ webkitdirectory: "", directory: "" }}
        onChange={(event) => {
          const relativePath = event.currentTarget.files?.[0]?.webkitRelativePath;
          const folder = relativePath?.split("/")[0];
          if (folder) setQuery(folder);
          window.setTimeout(() => inputRef.current?.focus(), 0);
        }}
      />

      <div className={styles.keyGuide}>
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>↵</kbd> choose</span>
        <span><kbd>esc</kbd> close</span>
      </div>
    </div>
  );

  if (presentation === "finder") {
    return (
      <div ref={containerRef} className={styles.finder}>
        <div className={styles.finderTitle}>
          <div>
            <strong>Find a project</strong>
            <span>Open a project anywhere in Scout</span>
          </div>
          <kbd>⌘K</kbd>
        </div>
        {searchSurface}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={styles.pickerWrap}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.projectTrigger} ${open ? styles.projectTriggerOpen : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className={styles.folder}><FolderGlyph /></span>
        <span className={styles.triggerIdentity}>
          <strong>{selected.name}</strong>
          <span>{selected.path}</span>
        </span>
        <span className={styles.triggerBranch}>{selected.branch}</span>
        <span className={styles.chevron}><ChevronGlyph /></span>
      </button>
      {open ? <div className={styles.pickerPopover}>{searchSurface}</div> : null}
    </div>
  );
}

function NewMessage({ selected, setSelected, initialOpen }: { selected: Project; setSelected: (project: Project) => void; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);

  return (
    <div className={styles.modal}>
      <div className={styles.modalHead}>
        <span className={styles.modalMark}>＋</span>
        <div>
          <strong>New conversation</strong>
          <span>Choose project and first message</span>
        </div>
        <button type="button" aria-label="Close">×</button>
      </div>

      <div className={styles.formLabel}>Project</div>
      <ProjectSearch
        presentation="message"
        selected={selected}
        open={open}
        onOpenChange={setOpen}
        onSelect={setSelected}
      />

      <div className={styles.runtimeRow}>
        <button type="button"><small>Harness</small><span><i /> Codex</span></button>
        <button type="button"><small>Model</small><span>Default⌄</span></button>
        <button type="button"><small>Effort</small><span>High⌄</span></button>
      </div>

      <div className={styles.formLabel}>First message</div>
      <div className={styles.composer}>
        <span>What should the agent start on?</span>
        <div>
          <button type="button">Cancel</button>
          <small>⌘↵ to start</small>
          <button type="button" className={styles.send}><ArrowGlyph /></button>
        </div>
      </div>
    </div>
  );
}

function DecisionLedger() {
  return (
    <section className={styles.ledger} aria-label="Study decisions">
      <div className={styles.ledgerRow}>
        <strong>One search model</strong>
        <span>Name, path, branch, host, and recency are normalized once. Picker and Finder differ only in presentation and completion action.</span>
      </div>
      <div className={styles.ledgerRow}>
        <strong>Recency is the empty state</strong>
        <span>Opening the field is immediately useful. The current and last-used projects rise naturally; the list never begins as an alphabetical directory.</span>
      </div>
      <div className={styles.ledgerRow}>
        <strong>Paths disambiguate identity</strong>
        <span>Project name leads, but path and branch remain visible so duplicate repos and worktrees do not collapse into repeated “openscout” rows.</span>
      </div>
      <div className={styles.ledgerRow}>
        <strong>Free text narrows; it does not invent</strong>
        <span>Unknown text yields recovery guidance and Choose a folder. It never silently treats an arbitrary string as a valid project path.</span>
      </div>
      <div className={styles.ledgerRow}>
        <strong>Recency is earned</strong>
        <span>“Last opened” advances only after a successful conversation start or Finder navigation—not when a row is merely highlighted or selected.</span>
      </div>
      <div className={styles.ledgerRow}>
        <strong>Share the index, not the view</strong>
        <span>Candidate identity, canonical-path dedupe, ranking, and recent history are shared. The embedded picker and Finder keep separate lifecycle, focus, and completion actions.</span>
      </div>
    </section>
  );
}

export default function ProjectPickerStudy() {
  const [presentation, setPresentation] = useState<Presentation>("message");
  const [selected, setSelected] = useState(PROJECTS[0]);
  const [finderOpen, setFinderOpen] = useState(true);
  const [messagePickerStartsOpen, setMessagePickerStartsOpen] = useState(true);
  const finderButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.metaKey && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setMessagePickerStartsOpen(false);
        setPresentation("finder");
        setFinderOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ScoutStudyShell
      pageId="project-picker"
      title="Project picker · Search first"
      blurb={<>A reusable project-search primitive for New Conversation and the broader project finder. Free type immediately; recent projects are the zero-query suggestions; path and branch keep worktrees legible.</>}
      initialSkin="graphite"
    >
      <div className={styles.modeBar}>
        <div>
          <span>Presentation</span>
          <strong>{presentation === "message" ? "Embedded picker" : "Global finder"}</strong>
        </div>
        <div className={styles.modeTabs}>
          <button type="button" className={presentation === "message" ? styles.modeTabActive : ""} onClick={() => { setMessagePickerStartsOpen(true); setPresentation("message"); }}>New conversation</button>
          <button ref={finderButtonRef} type="button" className={presentation === "finder" ? styles.modeTabActive : ""} onClick={() => { setMessagePickerStartsOpen(false); setPresentation("finder"); setFinderOpen(true); }}>Finder <kbd>⌘K</kbd></button>
        </div>
      </div>

      <section className={styles.stage}>
        <div className={styles.appGhost} aria-hidden>
          <div className={styles.ghostRail} />
          <div className={styles.ghostList} />
          <div className={styles.ghostBody} />
        </div>
        <div className={styles.scrim} aria-hidden />
        {presentation === "message" ? (
          <NewMessage selected={selected} setSelected={setSelected} initialOpen={messagePickerStartsOpen} />
        ) : (
          <ProjectSearch
            presentation="finder"
            selected={selected}
            open={finderOpen}
            onOpenChange={(open) => {
              setFinderOpen(open);
              if (!open) {
                setPresentation("message");
                window.setTimeout(() => finderButtonRef.current?.focus(), 0);
              }
            }}
            onSelect={setSelected}
          />
        )}
      </section>

      <DecisionLedger />
    </ScoutStudyShell>
  );
}
