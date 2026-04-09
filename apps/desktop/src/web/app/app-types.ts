import type { ReactNode } from "react";
import type { SettingsSectionId } from "@/settings/settings-paths";
import type { RelayMessage } from "@/lib/scout-desktop";

export type PendingRelayMessage = {
  clientMessageId: string;
  message: RelayMessage;
};

export type OnboardingWizardStepId = "welcome" | "source-roots" | "harness" | "confirm" | "setup" | "doctor" | "runtimes";
export type WorkspaceExplorerFilterTab = "all" | "bound" | "discovered";
export type WorkspaceExplorerViewMode = "grid" | "list";
export type InboxItemTone = "critical" | "warning" | "info";
export type InboxItemKind = "approval" | "finding" | "task";
export type InboxItem = {
  id: string;
  kind: InboxItemKind;
  tone: InboxItemTone;
  title: string;
  summary: string;
  detail: string | null;
  meta: string;
  actionLabel: string;
  onAction: () => void;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
};

export type ComposerRelayReference = {
  messageId: string;
  authorName: string;
  preview: string;
};

export type ProductSurface = "relay" | "pairing";
export type AppView = "overview" | "inbox" | "activity" | "machines" | "plans" | "sessions" | "search" | "messages" | "relay" | "inter-agent" | "agents" | "logs" | "settings" | "help";
export type MessagesDetailTab = "overview" | "live" | "history";
export type NavViewItem = { id: AppView; icon: ReactNode; title: string; badgeCount?: number };
export type SettingsSectionMeta = { id: SettingsSectionId; label: string; description: string; icon: ReactNode };
export type CreateAgentDraft = {
  projectPath: string;
  agentName: string;
  harness: "claude" | "codex";
};
