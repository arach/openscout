import type { ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { ActivityScreen } from "../../screens/ActivityScreen.tsx";
import { AgentInfoScreen } from "../../screens/AgentInfoScreen.tsx";
import { AgentsScreen } from "../../screens/AgentsScreen.tsx";
import { ConversationScreen } from "../../screens/ConversationScreen.tsx";
import { FleetScreen } from "../../screens/FleetScreen.tsx";
import { HomeScreen } from "../../screens/HomeScreen.tsx";
import { MeshScreen } from "../../screens/MeshScreen.tsx";
import { SessionsScreen } from "../../screens/SessionsScreen.tsx";
import { SettingsScreen } from "../../screens/SettingsScreen.tsx";
import { WorkDetailScreen } from "../../screens/WorkDetailScreen.tsx";

export function ScoutContent() {
  const { route, navigate } = useScout();
  return <ScoutSurface>{renderScreen(route, navigate)}</ScoutSurface>;
}

/** Paints the Scout content area background (since Hudson's Frame renders
 *  black chrome behind everything and doesn't read our theme tokens). */
function ScoutSurface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg)",
        color: "var(--ink)",
        minHeight: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}

function renderScreen(
  route: ReturnType<typeof useScout>["route"],
  navigate: ReturnType<typeof useScout>["navigate"],
) {
  switch (route.view) {
    case "conversation":
      return (
        <ConversationScreen
          conversationId={route.conversationId}
          initialComposeMode={route.composeMode}
          navigate={navigate}
        />
      );
    case "agent-info":
      return (
        <AgentInfoScreen
          conversationId={route.conversationId}
          navigate={navigate}
        />
      );
    case "settings":
      return <SettingsScreen navigate={navigate} />;
    case "agents":
      return (
        <AgentsScreen
          navigate={navigate}
          selectedAgentId={route.agentId}
          conversationId={route.conversationId}
        />
      );
    case "fleet":
      return <FleetScreen navigate={navigate} />;
    case "sessions":
      if (route.sessionId) {
        return (
          <ConversationScreen
            conversationId={route.sessionId}
            navigate={navigate}
          />
        );
      }
      return <SessionsScreen navigate={navigate} />;
    case "mesh":
      return <MeshScreen navigate={navigate} />;
    case "activity":
      return <ActivityScreen navigate={navigate} />;
    case "work":
      return <WorkDetailScreen workId={route.workId} navigate={navigate} />;
    default:
      return <HomeScreen navigate={navigate} />;
  }
}
