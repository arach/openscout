// Paths for the local broker HTTP API (see packages/runtime/src/broker-daemon.ts routeRequest).

export const scoutBrokerPaths = {
  health: "/health",
  v1: {
    node: "/v1/node",
    snapshot: "/v1/snapshot",
    messages: "/v1/messages",
    eventsStream: "/v1/events/stream",
    actors: "/v1/actors",
    agents: "/v1/agents",
    endpoints: "/v1/endpoints",
    conversations: "/v1/conversations",
    invocations: "/v1/invocations",
  },
} as const;

export function scoutBrokerMessagesListPath(search: URLSearchParams): string {
  const q = search.toString();
  return q ? `${scoutBrokerPaths.v1.messages}?${q}` : scoutBrokerPaths.v1.messages;
}

export const openAiAudioSpeechUrl = "https://api.openai.com/v1/audio/speech" as const;
