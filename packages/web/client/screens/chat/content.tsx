import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { ChannelsScreen } from "./ChannelsScreen.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";
import { ConversationsScreen } from "./ConversationsScreen.tsx";
import { MessagesScreen } from "./MessagesScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

export function ChatContent({ route, navigate }: { route: Route; navigate: Navigate }) {
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
    case "messages":
      return (
        <MessagesScreen
          conversationId={route.conversationId}
          navigate={navigate}
        />
      );
    case "channels":
      return <ChannelsScreen channelId={route.channelId} navigate={navigate} />;
    case "conversations":
      return <ConversationsScreen navigate={navigate} />;
    default:
      return null;
  }
}
