import { useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from "react";
import { actorColor } from "../../lib/colors.ts";
import { isComposerSendShortcut } from "../../lib/compose-shortcuts.ts";
import { DictationMic, type MicStatus } from "../../components/DictationMic.tsx";
import { SendIcon, StopIcon } from "./conversation-icons.tsx";
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
  isDm,
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
  isDm: boolean;
  onSend: () => void;
  onInterrupt: () => void;
}) {
  const [voiceStatus, setVoiceStatus] = useState<MicStatus | null>(null);
  const showVoiceStatus = voiceStatus && voiceStatus.state !== "idle" && voiceStatus.message;

  return (
    <form
      className="s-thread-compose"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="s-thread-compose-shell">
        {slashState.open && filteredSlashCommands.length > 0 && (
          <div
            className="s-thread-compose-suggest"
            role="listbox"
            aria-label="Slash commands"
          >
            <div className="s-thread-compose-suggest-label">
              Slash commands
            </div>
            {filteredSlashCommands.map((cmd, i) => (
              <button
                key={cmd.command}
                type="button"
                role="option"
                aria-selected={i === slashState.index}
                className={[
                  "s-thread-compose-suggest-item",
                  i === slashState.index &&
                    "s-thread-compose-suggest-item--active",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySlashCommand(cmd);
                }}
                onMouseEnter={() =>
                  setSlashState((s) => ({ ...s, index: i }))
                }
              >
                <span className="s-thread-compose-suggest-cmd">
                  {cmd.label}
                </span>
                <span className="s-thread-compose-suggest-desc">
                  {cmd.description}
                </span>
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
            <div className="s-thread-compose-suggest-label">
              Mention agent
            </div>
            {filteredMentions.map((m, i) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={i === mentionState.index}
                className={[
                  "s-thread-compose-suggest-item",
                  i === mentionState.index &&
                    "s-thread-compose-suggest-item--active",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applyMention(m);
                }}
                onMouseEnter={() =>
                  setMentionState((s) => ({ ...s, index: i }))
                }
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
                <span className="s-thread-compose-suggest-cmd">
                  @{m.handle}
                </span>
                <span className="s-thread-compose-suggest-desc">
                  {m.name}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="s-thread-compose-row">
          <textarea
            ref={composeRef}
            className="s-thread-compose-input"
            placeholder={composePlaceholder}
            value={draft}
            onChange={(event) => {
              const next = event.target.value;
              setDraft(next);
              updateTriggersFromDraft(next, event.target.selectionStart);
            }}
            onSelect={(event) => {
              const target = event.currentTarget;
              updateTriggersFromDraft(target.value, target.selectionStart);
            }}
            onBlur={() => {
              setTimeout(closeSuggestions, 120);
            }}
            onKeyDown={(event) => {
              if (isComposerSendShortcut(event)) {
                event.preventDefault();
                if (!sending && draft.trim()) {
                  onSend();
                }
                return;
              }

              const suggestOpen =
                (slashState.open && filteredSlashCommands.length > 0) ||
                (mentionState.open && filteredMentions.length > 0);
              if (suggestOpen) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
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
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  if (slashState.open) {
                    setSlashState((s) => ({
                      ...s,
                      index:
                        (s.index - 1 + filteredSlashCommands.length) %
                        filteredSlashCommands.length,
                    }));
                  } else if (mentionState.open) {
                    setMentionState((s) => ({
                      ...s,
                      index:
                        (s.index - 1 + filteredMentions.length) %
                        filteredMentions.length,
                    }));
                  }
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeSuggestions();
                  return;
                }
                if (event.key === "Enter" || event.key === "Tab") {
                  if (event.shiftKey) return;
                  event.preventDefault();
                  if (slashState.open) {
                    const pick =
                      filteredSlashCommands[slashState.index] ??
                      filteredSlashCommands[0];
                    if (pick) applySlashCommand(pick);
                  } else if (mentionState.open) {
                    const pick =
                      filteredMentions[mentionState.index] ??
                      filteredMentions[0];
                    if (pick) applyMention(pick);
                  }
                  return;
                }
              }
            }}
            rows={1}
          />

          <DictationMic
            onAppend={(text) =>
              setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
            }
            onStatus={setVoiceStatus}
          />

          {isStopMode ? (
            <button
              type="button"
              className="s-thread-compose-send s-thread-compose-send--stop"
              onClick={onInterrupt}
              aria-label="Stop agent"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              type="submit"
              className="s-thread-compose-send"
              disabled={sending || !draft.trim()}
              title="Send (Cmd+Enter)"
              aria-label={
                composeAction === "ask"
                  ? "Ask agent (Cmd+Enter)"
                  : composeAction === "steer"
                    ? "Steer agent (Cmd+Enter)"
                    : isDm
                      ? "Tell agent (Cmd+Enter)"
                      : "Send message (Cmd+Enter)"
              }
            >
              <SendIcon />
            </button>
          )}
        </div>
        {showVoiceStatus ? (
          <div
            className={[
              "s-thread-compose-voice-status",
              voiceStatus.state === "recording" ? "s-thread-compose-voice-status--recording" : "",
              voiceStatus.state === "processing" ? "s-thread-compose-voice-status--processing" : "",
            ].filter(Boolean).join(" ")}
            aria-live="polite"
          >
            {voiceStatus.message}
          </div>
        ) : null}
      </div>
    </form>
  );
}
