import { UserPlus } from "lucide-react";
import type { CSSProperties } from "react";
import { actorColor } from "../../lib/colors.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { conversationForAgent } from "../../lib/router.ts";
import type { Agent, Route } from "../../lib/types.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { BackToPicker } from "../../scout/slots/BackToPicker.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import {
  conversationIdentityLabel,
  shortConversationIdentity,
} from "./conversation-model.ts";

export type ConversationHeaderParticipant = {
  id: string;
  name: string;
  title: string;
  agent: Agent | null;
  operator?: boolean;
};

export function ConversationHeader({
  showBackNav,
  isDm,
  navigate,
  route,
  canonicalConversationId,
  threadTitle,
  agentId,
  visibleParticipants,
  hiddenParticipantCount,
  canAddParticipants,
  onToggleAddParticipant,
}: {
  showBackNav: boolean;
  isDm: boolean;
  navigate: (r: Route) => void;
  route: Route;
  canonicalConversationId: string;
  threadTitle: string;
  agentId: string | null;
  visibleParticipants: ConversationHeaderParticipant[];
  hiddenParticipantCount: number;
  canAddParticipants: boolean;
  onToggleAddParticipant: () => void;
}) {
  const showContextMenu = useContextMenu();
  return (
    <div
      className="s-thread-center-header"
      onClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button,a,input,select,textarea")) return;
        if (!isDm) return;
        openContent(
          navigate,
          { view: "agent-info", conversationId: canonicalConversationId },
          { returnTo: route },
        );
      }}
      style={isDm ? { cursor: "pointer" } : undefined}
      onContextMenu={(e) => {
        const items: MenuItem[] = [
          {
            kind: "action",
            label: "Copy Title",
            onSelect: () => {
              void copyTextToClipboard(threadTitle);
            },
          },
        ];
        if (agentId) {
          items.push({
            kind: "action",
            label: "Copy Agent ID",
            onSelect: () => {
              void copyTextToClipboard(agentId);
            },
          });
        }
        items.push({
          kind: "action",
          label: "Copy Conversation ID",
          onSelect: () => {
            void copyTextToClipboard(canonicalConversationId);
          },
        });
        showContextMenu(e, items);
      }}
    >
      {showBackNav && (
        <BackToPicker
          slot="conversation"
          fallback={{ view: "inbox" }}
          navigate={navigate}
          label="Back"
          className="s-thread-header-back"
        />
      )}
      <div className="s-thread-center-header-info">
        <span className="s-thread-center-header-name">{threadTitle}</span>
      </div>

      <div className="s-thread-center-header-right">
        {visibleParticipants.length > 0 && (
          <div className="s-thread-participants" aria-label="Conversation participants">
            {visibleParticipants.map((participant) => {
              const participantStyle = {
                background: actorColor(participant.name),
              } as CSSProperties;
              const content = (
                <>
                  <span
                    className="s-thread-participant-avatar"
                    style={participantStyle}
                    aria-hidden="true"
                  >
                    {participant.name[0]?.toUpperCase() ?? "?"}
                  </span>
                  <span className="s-thread-participant-name">
                    {participant.name}
                  </span>
                </>
              );
              if (participant.agent) {
                return (
                  <button
                    key={participant.id}
                    type="button"
                    className="s-thread-participant-pill s-thread-participant-pill--button"
                    title={`Open ${participant.name} profile`}
                    onClick={() =>
                      openContent(
                        navigate,
                        {
                          view: "agent-info",
                          conversationId: conversationForAgent(participant.agent!.id),
                        },
                        { returnTo: route },
                      )
                    }
                  >
                    {content}
                  </button>
                );
              }
              return (
                <span
                  key={participant.id}
                  className="s-thread-participant-pill"
                  title={participant.title}
                >
                  {content}
                </span>
              );
            })}
            {hiddenParticipantCount > 0 && (
              <span className="s-thread-participant-overflow">
                +{hiddenParticipantCount}
              </span>
            )}
          </div>
        )}
        {canAddParticipants && (
          <button
            type="button"
            className="s-thread-add-participant-trigger"
            onClick={onToggleAddParticipant}
            title="Add participant"
            aria-label="Add participant"
          >
            <UserPlus size={14} strokeWidth={1.9} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ConversationIdentityRow({
  canonicalConversationId,
  conversationAlias,
}: {
  canonicalConversationId: string;
  conversationAlias: string | null;
}) {
  return (
    <div className="s-thread-identity-row">
      <button
        type="button"
        className="s-thread-identity-chip"
        title={canonicalConversationId}
        onClick={() => void copyTextToClipboard(canonicalConversationId)}
      >
        <span>{conversationIdentityLabel(canonicalConversationId)}</span>
        <strong>{shortConversationIdentity(canonicalConversationId)}</strong>
      </button>
      {conversationAlias && (
        <span className="s-thread-identity-chip" title={conversationAlias}>
          <span>Alias</span>
          <strong>{conversationAlias}</strong>
        </span>
      )}
    </div>
  );
}

export function AddParticipantForm({
  agents,
  addParticipantId,
  setAddParticipantId,
  addingParticipant,
  addParticipantError,
  onCancel,
  onSubmit,
}: {
  agents: Agent[];
  addParticipantId: string;
  setAddParticipantId: (value: string) => void;
  addingParticipant: boolean;
  addParticipantError: string | null;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="s-thread-add-participant"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="s-thread-add-participant-row">
        <div className="s-thread-add-participant-field">
          <label
            className="s-thread-add-participant-label"
            htmlFor="thread-add-participant-select"
          >
            Agent
          </label>
          <select
            id="thread-add-participant-select"
            className="s-thread-add-participant-select"
            value={addParticipantId}
            onChange={(event) => setAddParticipantId(event.target.value)}
            autoFocus
          >
            {agents.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>

        <div className="s-thread-add-participant-actions">
          <button
            type="button"
            className="s-btn s-btn-sm"
            onClick={onCancel}
            disabled={addingParticipant}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="s-btn s-btn-primary s-btn-sm"
            disabled={addingParticipant || addParticipantId.trim().length === 0}
          >
            {addingParticipant ? "Adding..." : "Add"}
          </button>
        </div>
      </div>

      {addParticipantError && (
        <div className="s-thread-add-participant-error">
          {addParticipantError}
        </div>
      )}
    </form>
  );
}
