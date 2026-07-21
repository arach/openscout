import {
  type CSSProperties,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { actorColor } from "../../lib/colors.ts";
import { MessageComposer } from "../../components/MessageComposer/index.ts";
import type {
  ComposeAction,
  MentionCandidate,
  MentionSuggestState,
  SlashCommand,
  SlashSuggestState,
} from "./conversation-model.ts";

export function ConversationComposer({
  composeRef,
  draft,
  setDraft,
  composePlaceholder,
  slashState,
  setSlashState,
  filteredSlashCommands,
  applySlashCommand,
  mentionState,
  setMentionState,
  filteredMentions,
  applyMention,
  updateTriggersFromDraft,
  closeSuggestions,
  isStopMode,
  sending,
  composeAction,
  onSend,
  onInterrupt,
}: {
  composeRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  composePlaceholder: string;
  slashState: SlashSuggestState;
  setSlashState: Dispatch<SetStateAction<SlashSuggestState>>;
  filteredSlashCommands: SlashCommand[];
  applySlashCommand: (command: SlashCommand) => void;
  mentionState: MentionSuggestState;
  setMentionState: Dispatch<SetStateAction<MentionSuggestState>>;
  filteredMentions: MentionCandidate[];
  applyMention: (candidate: MentionCandidate) => void;
  updateTriggersFromDraft: (value: string, caret: number) => void;
  closeSuggestions: () => void;
  isStopMode: boolean;
  sending: boolean;
  composeAction: ComposeAction;
  onSend: () => void;
  onInterrupt: () => void;
}) {
  const overlay = (
    <>
      {slashState.open && filteredSlashCommands.length > 0 && (
        <div
          className="s-thread-compose-suggest"
          role="listbox"
          aria-label="Slash commands"
        >
          <div className="s-thread-compose-suggest-label">Slash commands</div>
          {filteredSlashCommands.map((cmd, i) => (
            <button
              key={cmd.command}
              type="button"
              role="option"
              aria-selected={i === slashState.index}
              className={[
                "s-thread-compose-suggest-item",
                i === slashState.index && "s-thread-compose-suggest-item--active",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                applySlashCommand(cmd);
              }}
              onMouseEnter={() => setSlashState((s) => ({ ...s, index: i }))}
            >
              <span className="s-thread-compose-suggest-cmd">{cmd.label}</span>
              <span className="s-thread-compose-suggest-desc">{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {mentionState.open && filteredMentions.length > 0 && (
        <div
          className="s-thread-compose-suggest"
          role="listbox"
          aria-label="Mention agents"
        >
          <div className="s-thread-compose-suggest-label">Mention agent</div>
          {filteredMentions.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={i === mentionState.index}
              className={[
                "s-thread-compose-suggest-item",
                i === mentionState.index && "s-thread-compose-suggest-item--active",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseDown={(e) => {
                e.preventDefault();
                applyMention(m);
              }}
              onMouseEnter={() => setMentionState((s) => ({ ...s, index: i }))}
            >
              <span
                className="s-ops-avatar s-thread-compose-suggest-avatar"
                style={{
                  "--size": "20px",
                  background: actorColor(m.name),
                } as CSSProperties}
              >
                {m.name[0]?.toUpperCase() ?? "?"}
              </span>
              <span className="s-thread-compose-suggest-cmd">@{m.handle}</span>
              <span className="s-thread-compose-suggest-desc">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <MessageComposer
      density="thread"
      value={draft}
      onChange={(next, meta) => {
        setDraft(next);
        updateTriggersFromDraft(next, meta?.caret ?? next.length);
      }}
      onSend={onSend}
      placeholder={composePlaceholder}
      sending={sending}
      stopMode={isStopMode}
      onStop={onInterrupt}
      sendAriaLabel={
        composeAction === "steer"
          ? "Send follow-up (Cmd+Enter)"
          : "Send message (Cmd+Enter)"
      }
      textareaRef={composeRef}
      overlay={overlay}
      status={sendReceipt ? (
        <div
          className="s-thread-compose-receipt"
          data-tone={sendReceipt.tone}
          role="status"
        >
          {sendReceipt.text}
        </div>
      ) : null}
      tools={(
        <span className="s-thread-compose-hint s-msg-compose-tools-hint">
          <kbd className="s-kbd">/</kbd> commands
          {" · "}
          <kbd className="s-kbd">@</kbd> agents
        </span>
      )}
      onSelect={(event) => {
        const target = event.currentTarget;
        updateTriggersFromDraft(target.value, target.selectionStart);
      }}
      onBlur={() => {
        setTimeout(closeSuggestions, 120);
      }}
      onKeyDown={(event) => {
        const suggestOpen =
          (slashState.open && filteredSlashCommands.length > 0)
          || (mentionState.open && filteredMentions.length > 0);
        if (!suggestOpen) return false;

        if (event.key === "ArrowDown") {
          if (slashState.open) {
            setSlashState((s) => ({
              ...s,
              index: (s.index + 1) % filteredSlashCommands.length,
            }));
          } else if (mentionState.open) {
            setMentionState((s) => ({
              ...s,
              index: (s.index + 1) % filteredMentions.length,
            }));
          }
          return true;
        }
        if (event.key === "ArrowUp") {
          if (slashState.open) {
            setSlashState((s) => ({
              ...s,
              index:
                (s.index - 1 + filteredSlashCommands.length)
                % filteredSlashCommands.length,
            }));
          } else if (mentionState.open) {
            setMentionState((s) => ({
              ...s,
              index:
                (s.index - 1 + filteredMentions.length)
                % filteredMentions.length,
            }));
          }
          return true;
        }
        if (event.key === "Escape") {
          closeSuggestions();
          return true;
        }
        if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
          if (slashState.open) {
            const pick =
              filteredSlashCommands[slashState.index]
              ?? filteredSlashCommands[0];
            if (pick) applySlashCommand(pick);
          } else if (mentionState.open) {
            const pick =
              filteredMentions[mentionState.index] ?? filteredMentions[0];
            if (pick) applyMention(pick);
          }
          return true;
        }
        return false;
      }}
    />
  );
}
