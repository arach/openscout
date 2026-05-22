import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type RangerActivity =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "briefing";

export type RangerReminderSummary = {
  id: string;
  body: string;
  status: "scheduled" | "due" | "dismissed";
  dueAt: number;
};

export type RangerPublicState = {
  activity: RangerActivity;
  brief: {
    lastDeliveredAt: number | null;
  };
  reminders: {
    dueCount: number;
    upcomingCount: number;
    due: RangerReminderSummary[];
    next: RangerReminderSummary | null;
  };
  voice: {
    available: boolean | null;
    setupBlocked: boolean;
    replies: boolean;
  };
  error: string | null;
  session: {
    title: string | null;
    lastActivityAt: number | null;
  };
};

export type RangerActionApi = {
  focusRanger: () => void;
  triggerBrief: () => void;
  triggerAskState: () => void;
  toggleVoiceReplies: () => void;
  openRangerSettings: () => void;
  startNewChat: () => void;
  dismissReminder: (id: string) => void;
  askReminderStatus: (reminder: { id: string; body: string }) => void;
};

export const DEFAULT_RANGER_STATE: RangerPublicState = {
  activity: "idle",
  brief: { lastDeliveredAt: null },
  reminders: { dueCount: 0, upcomingCount: 0, due: [], next: null },
  voice: { available: null, setupBlocked: false, replies: false },
  error: null,
  session: { title: null, lastActivityAt: null },
};

const noop = () => {};

const DEFAULT_RANGER_ACTIONS: RangerActionApi = {
  focusRanger: noop,
  triggerBrief: noop,
  triggerAskState: noop,
  toggleVoiceReplies: noop,
  openRangerSettings: noop,
  startNewChat: noop,
  dismissReminder: noop,
  askReminderStatus: noop,
};

type RangerStateContextValue = {
  state: RangerPublicState;
  actions: RangerActionApi;
  publishState: (next: RangerPublicState) => void;
  registerActions: (next: RangerActionApi) => void;
};

const RangerStateContext = createContext<RangerStateContextValue | null>(null);

export function RangerStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RangerPublicState>(DEFAULT_RANGER_STATE);
  const actionsRef = useRef<RangerActionApi>(DEFAULT_RANGER_ACTIONS);

  const publishState = useCallback((next: RangerPublicState) => {
    setState((prev) => (rangerStateEqual(prev, next) ? prev : next));
  }, []);

  const registerActions = useCallback((next: RangerActionApi) => {
    actionsRef.current = next;
  }, []);

  const stableActions = useMemo<RangerActionApi>(
    () => ({
      focusRanger: () => actionsRef.current.focusRanger(),
      triggerBrief: () => actionsRef.current.triggerBrief(),
      triggerAskState: () => actionsRef.current.triggerAskState(),
      toggleVoiceReplies: () => actionsRef.current.toggleVoiceReplies(),
      openRangerSettings: () => actionsRef.current.openRangerSettings(),
      startNewChat: () => actionsRef.current.startNewChat(),
      dismissReminder: (id) => actionsRef.current.dismissReminder(id),
      askReminderStatus: (reminder) => actionsRef.current.askReminderStatus(reminder),
    }),
    [],
  );

  const value = useMemo<RangerStateContextValue>(
    () => ({ state, actions: stableActions, publishState, registerActions }),
    [state, stableActions, publishState, registerActions],
  );

  return (
    <RangerStateContext.Provider value={value}>
      {children}
    </RangerStateContext.Provider>
  );
}

export function useRangerState(): {
  state: RangerPublicState;
  actions: RangerActionApi;
} {
  const ctx = useContext(RangerStateContext);
  if (!ctx) {
    return { state: DEFAULT_RANGER_STATE, actions: DEFAULT_RANGER_ACTIONS };
  }
  return { state: ctx.state, actions: ctx.actions };
}

export function useRangerStatePublisher(): {
  publishState: (next: RangerPublicState) => void;
  registerActions: (next: RangerActionApi) => void;
} | null {
  const ctx = useContext(RangerStateContext);
  if (!ctx) return null;
  return { publishState: ctx.publishState, registerActions: ctx.registerActions };
}

function rangerStateEqual(a: RangerPublicState, b: RangerPublicState): boolean {
  return (
    a.activity === b.activity &&
    a.brief.lastDeliveredAt === b.brief.lastDeliveredAt &&
    a.reminders.dueCount === b.reminders.dueCount &&
    a.reminders.upcomingCount === b.reminders.upcomingCount &&
    reminderListEqual(a.reminders.due, b.reminders.due) &&
    reminderSummaryEqual(a.reminders.next, b.reminders.next) &&
    a.voice.available === b.voice.available &&
    a.voice.setupBlocked === b.voice.setupBlocked &&
    a.voice.replies === b.voice.replies &&
    a.error === b.error &&
    a.session.title === b.session.title &&
    a.session.lastActivityAt === b.session.lastActivityAt
  );
}

function reminderListEqual(
  a: RangerReminderSummary[],
  b: RangerReminderSummary[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!reminderSummaryEqual(a[i], b[i])) return false;
  }
  return true;
}

function reminderSummaryEqual(
  a: RangerReminderSummary | null,
  b: RangerReminderSummary | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.body === b.body &&
    a.status === b.status &&
    a.dueAt === b.dueAt
  );
}
