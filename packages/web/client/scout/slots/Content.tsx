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
  const { route, navigate, agents, messages } = useScout();

  switch (route.view) {
    case "conversation":
      return <ConversationScreen conversationId={route.conversationId} navigate={navigate} />;
    case "agent-info":
      return <AgentInfoScreen conversationId={route.conversationId} navigate={navigate} />;
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
        return <ConversationScreen conversationId={route.sessionId} navigate={navigate} />;
      }
      return <SessionsScreen navigate={navigate} />;
    case "mesh":
      return <MeshScreen navigate={navigate} />;
    case "activity":
      return <ActivityScreen navigate={navigate} />;
    case "work":
      return <WorkDetailScreen workId={route.workId} navigate={navigate} />;
    default:
      return <HomeScreen agents={agents} messages={messages} navigate={navigate} />;
  }
}
