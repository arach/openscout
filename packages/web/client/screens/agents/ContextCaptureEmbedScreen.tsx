import type { Route } from "../../lib/types.ts";
import { parseCaptureContextItems, type CaptureContextItem } from "../../lib/context-capture-message.ts";
import { useScout } from "../../scout/Provider.tsx";
import { defineSurface } from "../../surfaces/types.ts";
import { NewChatComposer } from "./NewChatComposer.tsx";

type ContextCaptureEmbedProps = {
  navigate: (route: Route) => void;
  initialAgentId?: string;
  initialConversationId?: string;
  initialMessage?: string;
  contextItems?: CaptureContextItem[];
  preferExistingChat?: boolean;
};

export function ContextCaptureEmbedScreen({
  navigate,
  initialAgentId,
  initialConversationId,
  initialMessage,
  contextItems,
  preferExistingChat,
}: ContextCaptureEmbedProps) {
  const { agents, route } = useScout();

  return (
    <NewChatComposer
      embedded
      agents={agents}
      route={route}
      navigate={navigate}
      onClose={() => {}}
      initialAgentId={initialAgentId}
      initialConversationId={initialConversationId}
      initialMessage={initialMessage}
      contextItems={contextItems}
      defaultMode={preferExistingChat ? "existing-chat" : undefined}
    />
  );
}

export const scoutSurface = defineSurface({
  id: "context-capture",
  label: "Context capture",
  route: { view: "inbox" },
  webPath: "/",
  screen: "ContextCaptureEmbedScreen",
  embed: {
    path: "/embed/context-capture",
    profile: "web.context-capture",
    rootClassName: "s-context-capture-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: false },
    resolveEmbedProps: (params) => ({
      initialAgentId: params.get("agent")?.trim() || undefined,
      initialConversationId: params.get("conversation")?.trim() || undefined,
      initialMessage: params.get("message") || undefined,
      contextItems: parseCaptureContextItems(params.get("context")),
      preferExistingChat: params.get("mode") === "existing-chat",
    }),
  },
});
