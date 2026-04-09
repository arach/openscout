import type {
  AppSettingsState,
  PairingState,
  SetupProjectSummary,
} from "@/lib/scout-desktop";
import type { CreateAgentDraft } from "@/app-types";

export function normalizeCreateAgentHarness(value: string | null | undefined): CreateAgentDraft["harness"] {
  return value === "codex" ? "codex" : "claude";
}

export function buildDefaultCreateAgentDraft(
  projects: SetupProjectSummary[],
  settings: AppSettingsState | null | undefined,
): CreateAgentDraft {
  const preferredProject = projects.find((project) => project.root === settings?.onboardingContextRoot)
    ?? projects[0]
    ?? null;

  return {
    projectPath: preferredProject?.root ?? settings?.onboardingContextRoot ?? "",
    agentName: "",
    harness: normalizeCreateAgentHarness(preferredProject?.defaultHarness ?? settings?.defaultHarness),
  };
}

export function pairingTrustedPeersMeaningfullyEqual(left: PairingState["trustedPeers"], right: PairingState["trustedPeers"]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((peer, index) => {
    const other = right[index];
    return peer.publicKey === other?.publicKey
      && peer.fingerprint === other?.fingerprint
      && peer.name === other?.name
      && peer.pairedAt === other?.pairedAt
      && peer.pairedAtLabel === other?.pairedAtLabel
      && peer.lastSeen === other?.lastSeen
      && peer.lastSeenLabel === other?.lastSeenLabel;
  });
}

export function pairingApprovalsMeaningfullyEqual(left: PairingState["pendingApprovals"], right: PairingState["pendingApprovals"]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((approval, index) => {
    const other = right[index];
    return approval.sessionId === other?.sessionId
      && approval.turnId === other?.turnId
      && approval.blockId === other?.blockId
      && approval.version === other?.version
      && approval.risk === other?.risk
      && approval.title === other?.title
      && approval.description === other?.description
      && approval.detail === other?.detail
      && approval.actionKind === other?.actionKind
      && approval.actionStatus === other?.actionStatus;
  });
}

export function pairingStatesMeaningfullyEqual(left: PairingState | null, right: PairingState | null) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return left === right;
  }

  return left.status === right.status
    && left.statusLabel === right.statusLabel
    && left.statusDetail === right.statusDetail
    && left.connectedPeerFingerprint === right.connectedPeerFingerprint
    && left.isRunning === right.isRunning
    && left.commandLabel === right.commandLabel
    && left.configPath === right.configPath
    && left.identityPath === right.identityPath
    && left.trustedPeersPath === right.trustedPeersPath
    && left.logPath === right.logPath
    && left.relay === right.relay
    && left.configuredRelay === right.configuredRelay
    && left.secure === right.secure
    && left.workspaceRoot === right.workspaceRoot
    && left.sessionCount === right.sessionCount
    && left.identityFingerprint === right.identityFingerprint
    && left.trustedPeerCount === right.trustedPeerCount
    && pairingTrustedPeersMeaningfullyEqual(left.trustedPeers, right.trustedPeers)
    && pairingApprovalsMeaningfullyEqual(left.pendingApprovals, right.pendingApprovals)
    && left.logTail === right.logTail
    && left.logUpdatedAtLabel === right.logUpdatedAtLabel
    && left.logMissing === right.logMissing
    && left.logTruncated === right.logTruncated
    && left.pairing?.relay === right.pairing?.relay
    && left.pairing?.room === right.pairing?.room
    && left.pairing?.publicKey === right.pairing?.publicKey
    && left.pairing?.expiresAt === right.pairing?.expiresAt
    && left.pairing?.qrValue === right.pairing?.qrValue
    && left.pairing?.qrArt === right.pairing?.qrArt;
}
