import type { ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { ActivityScreen } from "../../screens/ActivityScreen.tsx";
import { AgentInfoScreen } from "../../screens/AgentInfoScreen.tsx";
import { AgentsScreen } from "../../screens/AgentsScreen.tsx";
import { BriefingDetailScreen } from "../../screens/BriefingDetailScreen.tsx";
import { BriefingsScreen } from "../../screens/BriefingsScreen.tsx";
import { BrokerScreen } from "../../screens/BrokerScreen.tsx";
import { ChannelsScreen } from "../../screens/ChannelsScreen.tsx";
import { ConversationScreen } from "../../screens/ConversationScreen.tsx";
import { ConversationsScreen } from "../../screens/ConversationsScreen.tsx";
import { FollowScreen } from "../../screens/FollowScreen.tsx";
import { HarnessesScreen } from "../../screens/HarnessesScreen.tsx";
import { HomeScreen } from "../../screens/HomeScreen.tsx";
import { KnowledgeSearchScreen } from "../../screens/KnowledgeSearchScreen.tsx";
import { MeshScreen } from "../../screens/MeshScreen.tsx";
import { MessagesScreen } from "../../screens/MessagesScreen.tsx";
import { ReposScreen } from "../../screens/ReposScreen.tsx";
import { RepoDiffPageScreen } from "../../screens/RepoDiffPageScreen.tsx";
import { SessionsScreen } from "../../screens/SessionsScreen.tsx";
import { SessionRefScreen } from "../../screens/SessionRefScreen.tsx";
import { SettingsScreen } from "../../screens/SettingsScreen.tsx";
import { OpsScreen } from "../../screens/OpsScreen.tsx";
import { TerminalScreen } from "../../screens/TerminalScreen.tsx";
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
      <div className="scout-surface-body">
        {children}
      </div>
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
          initialDraft={route.composeDraft}
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
      return <SettingsScreen navigate={navigate} section={route.section} agentId={route.agentId} />;
    case "agents":
      return (
        <AgentsScreen
          navigate={navigate}
          selectedAgentId={route.agentId}
          conversationId={route.conversationId}
          tab={route.tab}
          activeRoute={route}
        />
      );
    case "fleet":
      return <HomeScreen navigate={navigate} />;
    case "conversations":
      return <ConversationsScreen navigate={navigate} />;
    case "messages":
      return (
        <MessagesScreen
          conversationId={route.conversationId}
          navigate={navigate}
        />
      );
    case "sessions":
      if (route.sessionId) {
        return (
          <SessionRefScreen
            sessionRef={route.sessionId}
            navigate={navigate}
          />
        );
      }
      return <SessionsScreen navigate={navigate} />;
    case "search":
      return <KnowledgeSearchScreen navigate={navigate} mode={route.mode} />;
    case "channels":
      return <ChannelsScreen channelId={route.channelId} navigate={navigate} />;
    case "mesh":
      return <MeshScreen navigate={navigate} />;
    case "broker":
      return <BrokerScreen navigate={navigate} />;
    case "repos":
      return <ReposScreen navigate={navigate} />;
    case "harnesses":
      return <HarnessesScreen navigate={navigate} />;
    case "repo-diff":
      return (
        <RepoDiffPageScreen
          path={route.path}
          layers={route.layers}
          files={route.files}
          sessionId={route.sessionId}
          agentId={route.agentId}
          include={route.include}
          navigate={navigate}
        />
      );
    case "briefings":
      return route.briefingId
        ? <BriefingDetailScreen briefingId={route.briefingId} navigate={navigate} />
        : <BriefingsScreen navigate={navigate} />;
    case "activity":
      return <ActivityScreen navigate={navigate} />;
    case "ops":
      return <OpsScreen navigate={navigate} mode={route.mode} tailQuery={route.tailQuery} />;
    case "terminal":
      return <TerminalScreen agentId={route.agentId} mode={route.mode} navigate={navigate} />;
    case "work":
      return <WorkDetailScreen workId={route.workId} navigate={navigate} />;
    case "follow":
      return <FollowScreen route={route} navigate={navigate} />;
    default:
      return <HomeScreen navigate={navigate} />;
  }
}
