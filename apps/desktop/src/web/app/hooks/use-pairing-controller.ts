import React from "react";

import { asErrorMessage } from "@web/features/messages/lib/relay-utils";
import { pairingStatesMeaningfullyEqual } from "@/app-utils";
import type { ScoutDesktopBridge } from "@/lib/desktop-bridge";
import type { PairingState, UpdatePairingConfigInput } from "@/lib/scout-desktop";

type UsePairingControllerInput = {
  pairingEnabled: boolean;
  scoutDesktop: ScoutDesktopBridge | null;
  setRelayFeedback: React.Dispatch<React.SetStateAction<string | null>>;
};

export function usePairingController({
  pairingEnabled,
  scoutDesktop,
  setRelayFeedback,
}: UsePairingControllerInput) {
  const [pairingState, setPairingState] = React.useState<PairingState | null>(null);
  const [pairingLoading, setPairingLoading] = React.useState(false);
  const [pairingError, setPairingError] = React.useState<string | null>(null);
  const [pairingControlPending, setPairingControlPending] = React.useState(false);
  const [pairingConfigPending, setPairingConfigPending] = React.useState(false);
  const [pairingApprovalPendingId, setPairingApprovalPendingId] = React.useState<string | null>(null);
  const [pairingConfigFeedback, setPairingConfigFeedback] = React.useState<string | null>(null);

  const pairingStateRef = React.useRef<PairingState | null>(null);
  const pairingLoadRequestIdRef = React.useRef(0);

  React.useEffect(() => {
    pairingStateRef.current = pairingState;
  }, [pairingState]);

  React.useEffect(() => {
    if (pairingEnabled) {
      return;
    }

    setPairingState(null);
    setPairingLoading(false);
    setPairingError(null);
    setPairingControlPending(false);
    setPairingConfigPending(false);
    setPairingApprovalPendingId(null);
    setPairingConfigFeedback(null);
  }, [pairingEnabled]);

  const commitPairingState = React.useCallback((nextState: PairingState) => {
    setPairingState((current) => (
      pairingStatesMeaningfullyEqual(current, nextState) ? current : nextState
    ));
  }, []);

  const syncPairingState = React.useCallback(async (
    reader: (() => Promise<PairingState>) | undefined,
    options?: { showLoading?: boolean; throwOnError?: boolean },
  ) => {
    if (!pairingEnabled || !reader) {
      return null;
    }

    const requestId = ++pairingLoadRequestIdRef.current;
    if (options?.showLoading) {
      setPairingLoading(true);
    }

    try {
      const nextState = await reader();
      if (pairingLoadRequestIdRef.current !== requestId) {
        return nextState;
      }
      commitPairingState(nextState);
      setPairingError(null);
      return nextState;
    } catch (error) {
      if (pairingLoadRequestIdRef.current === requestId) {
        setPairingError(asErrorMessage(error));
      }
      if (options?.throwOnError) {
        throw error;
      }
      return null;
    } finally {
      if (options?.showLoading && pairingLoadRequestIdRef.current === requestId) {
        setPairingLoading(false);
      }
    }
  }, [commitPairingState, pairingEnabled]);

  React.useEffect(() => {
    if (!pairingEnabled || !scoutDesktop?.getPairingState) {
      return;
    }

    void syncPairingState(
      () => scoutDesktop.getPairingState(),
      { showLoading: pairingStateRef.current === null },
    );

    const intervalId = window.setInterval(() => {
      void syncPairingState(() => scoutDesktop.getPairingState());
    }, 5_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pairingEnabled, scoutDesktop, syncPairingState]);

  const refreshPairingState = React.useCallback(async () => {
    if (!pairingEnabled) {
      return null;
    }

    if (scoutDesktop?.refreshPairingState) {
      return syncPairingState(
        () => scoutDesktop.refreshPairingState(),
        { throwOnError: true },
      );
    }

    return syncPairingState(
      scoutDesktop?.getPairingState ? () => scoutDesktop.getPairingState() : undefined,
      { throwOnError: true },
    );
  }, [pairingEnabled, scoutDesktop, syncPairingState]);

  const handlePairingControl = React.useCallback(async (action: "start" | "stop" | "restart") => {
    if (!scoutDesktop?.controlPairingService) {
      return;
    }

    setPairingControlPending(true);
    try {
      const nextState = await scoutDesktop.controlPairingService(action);
      commitPairingState(nextState);
      setPairingError(null);
      setRelayFeedback(
        action === "start"
          ? "Pairing started."
          : action === "stop"
            ? "Pairing stopped."
            : "Pairing restarted.",
      );
    } catch (error) {
      setPairingError(asErrorMessage(error));
    } finally {
      setPairingControlPending(false);
    }
  }, [commitPairingState, scoutDesktop, setRelayFeedback]);

  const handleUpdatePairingConfig = React.useCallback(async (input: UpdatePairingConfigInput) => {
    if (!scoutDesktop?.updatePairingConfig) {
      return;
    }

    setPairingConfigPending(true);
    setPairingConfigFeedback(null);
    try {
      const nextState = await scoutDesktop.updatePairingConfig(input);
      commitPairingState(nextState);
      setPairingError(null);
      setPairingConfigFeedback("Pairing settings saved.");
    } catch (error) {
      const message = asErrorMessage(error);
      setPairingConfigFeedback(message);
      throw error;
    } finally {
      setPairingConfigPending(false);
    }
  }, [commitPairingState, scoutDesktop]);

  const handleDecidePairingApproval = React.useCallback(async (
    approval: NonNullable<PairingState>["pendingApprovals"][number],
    decision: "approve" | "deny",
  ) => {
    if (!scoutDesktop?.decidePairingApproval) {
      return;
    }

    const approvalId = `${approval.sessionId}:${approval.turnId}:${approval.blockId}:${decision}`;
    setPairingApprovalPendingId(approvalId);
    try {
      const nextState = await scoutDesktop.decidePairingApproval({
        sessionId: approval.sessionId,
        turnId: approval.turnId,
        blockId: approval.blockId,
        version: approval.version,
        decision,
      });
      commitPairingState(nextState);
      setPairingError(null);
      setRelayFeedback(decision === "approve" ? "Approval sent." : "Action denied.");
    } catch (error) {
      setPairingError(asErrorMessage(error));
    } finally {
      setPairingApprovalPendingId((current) => (current === approvalId ? null : current));
    }
  }, [commitPairingState, scoutDesktop, setRelayFeedback]);

  return {
    pairingState,
    pairingLoading,
    pairingError,
    setPairingError,
    pairingControlPending,
    pairingConfigPending,
    pairingApprovalPendingId,
    pairingConfigFeedback,
    setPairingConfigFeedback,
    pendingApprovals: pairingState?.pendingApprovals ?? [],
    commitPairingState,
    refreshPairingState,
    handlePairingControl,
    handleUpdatePairingConfig,
    handleDecidePairingApproval,
  };
}
