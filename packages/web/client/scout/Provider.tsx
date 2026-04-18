import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "../lib/router.ts";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import type { Agent, Message, Route } from "../lib/types.ts";

export interface ScoutContextValue {
  route: Route;
  navigate: (r: Route) => void;

  agents: Agent[];
  messages: Message[];
  onlineCount: number;

  reload: () => Promise<void>;
}

const ScoutContext = createContext<ScoutContextValue | null>(null);

export function useScout() {
  const ctx = useContext(ScoutContext);
  if (!ctx) throw new Error("useScout must be used inside ScoutProvider");
  return ctx;
}

export function ScoutProvider({ children }: { children: ReactNode }) {
  const { route, navigate } = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const reload = useCallback(async () => {
    const [agentsResult, messagesResult] = await Promise.allSettled([
      api<Agent[]>("/api/agents"),
      api<Message[]>("/api/messages"),
    ]);
    if (agentsResult.status === "fulfilled") setAgents(agentsResult.value);
    if (messagesResult.status === "fulfilled") setMessages(messagesResult.value);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useBrokerEvents(reload);

  const onlineCount = useMemo(
    () => agents.filter((a) => isAgentOnline(a.state)).length,
    [agents],
  );

  const value = useMemo<ScoutContextValue>(
    () => ({ route, navigate, agents, messages, onlineCount, reload }),
    [route, navigate, agents, messages, onlineCount, reload],
  );

  return <ScoutContext.Provider value={value}>{children}</ScoutContext.Provider>;
}
