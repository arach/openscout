import React from "react";

import { asErrorMessage } from "@web/features/messages/lib/relay-utils";
import type { AppView } from "@/app-types";
import type { ScoutDesktopBridge } from "@/lib/electron";
import type { PhonePreparationState, SessionMetadata } from "@/lib/scout-desktop";

type UsePhonePreparationControllerInput = {
  activeView: AppView;
  scoutDesktop: ScoutDesktopBridge | null;
  sessions: SessionMetadata[];
};

const EMPTY_PHONE_PREPARATION_STATE: PhonePreparationState = {
  favorites: [],
  quickHits: [],
  preparedAt: null,
};

export function usePhonePreparationController({
  activeView,
  scoutDesktop,
  sessions,
}: UsePhonePreparationControllerInput) {
  const [phonePreparation, setPhonePreparation] = React.useState<PhonePreparationState | null>(null);
  const [phonePreparationLoading, setPhonePreparationLoading] = React.useState(false);
  const [phonePreparationSaving, setPhonePreparationSaving] = React.useState(false);
  const [phonePreparationFeedback, setPhonePreparationFeedback] = React.useState<string | null>(null);
  const [draggedSessionId, setDraggedSessionId] = React.useState<string | null>(null);
  const [draggedPhoneSection, setDraggedPhoneSection] = React.useState<"favorites" | "quickHits" | null>(null);

  const phonePreparationRef = React.useRef<PhonePreparationState | null>(null);
  const phoneSaveRequestIdRef = React.useRef(0);

  React.useEffect(() => {
    phonePreparationRef.current = phonePreparation;
  }, [phonePreparation]);

  React.useEffect(() => {
    if (activeView !== "sessions" || !scoutDesktop?.getPhonePreparation) {
      return;
    }

    let cancelled = false;
    const loadPhonePreparation = async () => {
      setPhonePreparationLoading(true);
      try {
        const nextState = await scoutDesktop.getPhonePreparation();
        if (cancelled) {
          return;
        }
        setPhonePreparation(nextState);
        setPhonePreparationFeedback(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setPhonePreparation(null);
        setPhonePreparationFeedback(asErrorMessage(error));
      } finally {
        if (!cancelled) {
          setPhonePreparationLoading(false);
        }
      }
    };

    void loadPhonePreparation();
    return () => {
      cancelled = true;
    };
  }, [activeView, scoutDesktop]);

  const phonePreparationState = phonePreparation ?? EMPTY_PHONE_PREPARATION_STATE;

  const sessionsById = React.useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );

  const preparedPhoneCandidates = React.useMemo(
    () => [...sessions]
      .sort((left, right) =>
        new Date(right.lastModified).getTime() - new Date(left.lastModified).getTime()
        || right.messageCount - left.messageCount
        || left.title.localeCompare(right.title),
      ),
    [sessions],
  );

  const favoritePhoneSessions = React.useMemo(
    () => phonePreparationState.favorites
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is SessionMetadata => Boolean(session)),
    [phonePreparationState.favorites, sessionsById],
  );

  const quickHitPhoneSessions = React.useMemo(
    () => phonePreparationState.quickHits
      .filter((sessionId) => !phonePreparationState.favorites.includes(sessionId))
      .map((sessionId) => sessionsById.get(sessionId))
      .filter((session): session is SessionMetadata => Boolean(session)),
    [phonePreparationState.favorites, phonePreparationState.quickHits, sessionsById],
  );

  const persistPhonePreparation = React.useCallback(async (
    nextState: PhonePreparationState,
    successMessage?: string | null,
  ) => {
    if (!scoutDesktop?.updatePhonePreparation) {
      setPhonePreparationFeedback("Phone preparation is unavailable in this build.");
      return;
    }

    const requestId = ++phoneSaveRequestIdRef.current;
    const previous = phonePreparationRef.current;
    setPhonePreparation(nextState);
    setPhonePreparationSaving(true);

    try {
      const saved = await scoutDesktop.updatePhonePreparation(nextState);
      if (phoneSaveRequestIdRef.current !== requestId) {
        return;
      }

      setPhonePreparation(saved);
      if (successMessage) {
        setPhonePreparationFeedback(successMessage);
      } else if (successMessage === null) {
        setPhonePreparationFeedback(null);
      }
    } catch (error) {
      if (phoneSaveRequestIdRef.current !== requestId) {
        return;
      }

      setPhonePreparation(previous);
      setPhonePreparationFeedback(asErrorMessage(error));
    } finally {
      if (phoneSaveRequestIdRef.current === requestId) {
        setPhonePreparationSaving(false);
        setDraggedSessionId(null);
        setDraggedPhoneSection(null);
      }
    }
  }, [scoutDesktop]);

  const updatePhonePreparation = React.useCallback((
    mutator: (current: PhonePreparationState) => PhonePreparationState,
    successMessage?: string | null,
  ) => {
    const nextState = mutator(phonePreparationRef.current ?? EMPTY_PHONE_PREPARATION_STATE);
    void persistPhonePreparation(nextState, successMessage);
  }, [persistPhonePreparation]);

  const handlePreparePhone = React.useCallback(() => {
    const favorites = phonePreparationState.favorites.filter((sessionId) => sessionsById.has(sessionId));
    const quickHits = preparedPhoneCandidates
      .map((session) => session.id)
      .filter((sessionId) => !favorites.includes(sessionId))
      .slice(0, 8);

    void persistPhonePreparation({
      favorites,
      quickHits,
      preparedAt: Date.now(),
    }, `Prepared ${favorites.length + quickHits.length} phone picks.`);
  }, [persistPhonePreparation, phonePreparationState.favorites, preparedPhoneCandidates, sessionsById]);

  const handleClearPhoneQuickHits = React.useCallback(() => {
    updatePhonePreparation((current) => ({
      ...current,
      quickHits: [],
      preparedAt: Date.now(),
    }), "Cleared My List. Favorites stayed pinned.");
  }, [updatePhonePreparation]);

  const handleAddSessionToPhoneSection = React.useCallback((sessionId: string, section: "favorites" | "quickHits") => {
    updatePhonePreparation((current) => {
      if (section === "favorites") {
        return {
          favorites: current.favorites.includes(sessionId) ? current.favorites : [...current.favorites, sessionId],
          quickHits: current.quickHits.filter((id) => id !== sessionId),
          preparedAt: Date.now(),
        };
      }

      if (current.favorites.includes(sessionId) || current.quickHits.includes(sessionId)) {
        return {
          ...current,
          preparedAt: Date.now(),
        };
      }

      return {
        ...current,
        quickHits: [...current.quickHits, sessionId],
        preparedAt: Date.now(),
      };
    }, section === "favorites" ? "Pinned for phone." : "Added to My List.");
  }, [updatePhonePreparation]);

  const handleRemoveSessionFromPhoneSection = React.useCallback((sessionId: string, section: "favorites" | "quickHits") => {
    updatePhonePreparation((current) => ({
      favorites: section === "favorites" ? current.favorites.filter((id) => id !== sessionId) : current.favorites,
      quickHits: section === "quickHits" ? current.quickHits.filter((id) => id !== sessionId) : current.quickHits,
      preparedAt: Date.now(),
    }), section === "favorites" ? "Removed from phone favorites." : "Removed from My List.");
  }, [updatePhonePreparation]);

  const handleDropIntoFavorites = React.useCallback(() => {
    if (!draggedSessionId) {
      return;
    }

    handleAddSessionToPhoneSection(draggedSessionId, "favorites");
  }, [draggedSessionId, handleAddSessionToPhoneSection]);

  const handleDropIntoQuickHits = React.useCallback((targetIndex?: number) => {
    if (!draggedSessionId) {
      return;
    }

    updatePhonePreparation((current) => {
      if (current.favorites.includes(draggedSessionId)) {
        return {
          ...current,
          preparedAt: Date.now(),
        };
      }

      const nextQuickHits = current.quickHits.filter((id) => id !== draggedSessionId);
      const normalizedTargetIndex = typeof targetIndex === "number"
        ? Math.max(0, Math.min(targetIndex, nextQuickHits.length))
        : nextQuickHits.length;
      nextQuickHits.splice(normalizedTargetIndex, 0, draggedSessionId);

      return {
        ...current,
        quickHits: nextQuickHits,
        preparedAt: Date.now(),
      };
    }, draggedPhoneSection === "quickHits" ? "Reordered My List." : "Added to My List.");
  }, [draggedPhoneSection, draggedSessionId, updatePhonePreparation]);

  return {
    phonePreparationState,
    phonePreparationLoading,
    phonePreparationSaving,
    phonePreparationFeedback,
    setDraggedSessionId,
    setDraggedPhoneSection,
    favoritePhoneSessions,
    quickHitPhoneSessions,
    handlePreparePhone,
    handleClearPhoneQuickHits,
    handleDropIntoFavorites,
    handleDropIntoQuickHits,
    handleRemoveSessionFromPhoneSection,
    handleAddSessionToPhoneSection,
  };
}
