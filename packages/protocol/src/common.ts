export type ScoutId = string;

export type ActorKind =
  | "person"
  | "helper"
  | "agent"
  | "system"
  | "bridge"
  | "device";

export type AgentState =
  | "offline"
  | "idle"
  | "active"
  | "waiting";

export type VisibilityScope = "private" | "workspace" | "public" | "system";

export type DeliveryStatus =
  | "pending"
  | "leased"
  | "sent"
  | "acknowledged"
  | "failed"
  | "cancelled";

export type DeliveryPolicy = "best_effort" | "must_ack" | "durable" | "ephemeral";

export type DeliveryTargetKind =
  | "participant"
  | "agent"
  | "bridge"
  | "device"
  | "voice_session"
  | "webhook";

export type DeliveryTransport =
  | "local_socket"
  | "websocket"
  | "peer_broker"
  | "http"
  | "webhook"
  | "telegram"
  | "discord"
  | "sms"
  | "email"
  | "tts"
  | "native_voice"
  | "claude_stream_json"
  | "codex_app_server"
  | "codex_exec"
  | "claude_resume"
  | "tmux";

export type DeliveryReason =
  | "conversation_visibility"
  | "direct_message"
  | "mention"
  | "thread_reply"
  | "invocation"
  | "bridge_outbound"
  | "speech";

export type AdvertiseScope = "local" | "mesh";

export type ShareMode = "local" | "summary" | "shared";

export interface MetadataMap {
  [key: string]: unknown;
}
