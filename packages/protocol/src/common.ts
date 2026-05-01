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
  // Outbox lifecycle (Issue 3 of broker-three-contracts)
  | "accepted"        // local journal write done, awaiting forward
  | "peer_acked"      // peer broker journaled the envelope
  | "running"         // target agent claimed the flight
  | "completed"       // terminal success
  | "deferred"        // within retry window — see metadata.nextAttemptAt
  | "failed"          // terminal failure — see metadata.failureReason
  | "cancelled"
  // Legacy values kept for backwards-compatible journal replay
  | "pending"
  | "leased"
  | "sent"
  | "acknowledged";

export type DeliveryFailureReason =
  | "peer_unreachable"   // TCP/network failure — retry-able
  | "peer_rejected"      // peer broker explicitly refused — not retried
  | "agent_offline"      // peer ACK'd but target agent never claimed
  | "timeout"
  | "harness_error"
  | "dispatch"           // ambiguous label — see metadata.scoutDispatch
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
  | "pairing_bridge"
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
  | "tmux"
  | "cursor_exec";

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
