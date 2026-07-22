// Kept shared so the browser request and Hono route stay on the same contract.
export const SCOUT_REALTIME_VOICE_CALL_PATH = "/api/voice/realtime/call";
export const SCOUT_REALTIME_VOICE_FLAG = "surface.realtime-voice";
export const SCOUT_REALTIME_VOICE_FLAG_HEADER = "x-openscout-feature-realtime-voice";
export const SCOUT_REALTIME_VOICE_FLAG_HEADER_VALUE = "on";

// The Realtime function handler delegates through the existing Scoutbot control
// loop instead of giving the browser direct access to broker records.
export const SCOUT_REALTIME_SCOUTBOT_CHAT_PATH = "/api/scoutbot/chat";
