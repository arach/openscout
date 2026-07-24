import type { ScoutId } from "./common.js";

export const SCOUT_RENDEZVOUS_MAX_TOPIC_CODE_POINTS = 120;
export const SCOUT_RENDEZVOUS_MAX_WAIT_MS = 30_000;

export type ScoutRendezvousRequest = {
  topic: string;
  projectRoot: string;
  participantId: ScoutId;
  waitMs?: number;
};

export type ScoutRendezvousWaitingResponse = {
  status: "waiting";
  topic: string;
  projectRoot: string;
  participantId: ScoutId;
  joinedAt: number;
  expiresAt: number;
};

export type ScoutRendezvousMatchedResponse = {
  status: "matched";
  matchId: ScoutId;
  topic: string;
  projectRoot: string;
  participantId: ScoutId;
  participantIds: [ScoutId, ScoutId];
  peerParticipantIds: ScoutId[];
  createdAt: number;
  expiresAt: number;
};

export type ScoutRendezvousTopicBusyResponse = {
  status: "topic_busy";
  topic: string;
  projectRoot: string;
  participantId: ScoutId;
  participantCount: number;
  expiresAt: number;
  suggestion: "choose_another_topic";
};

export type ScoutRendezvousResponse =
  | ScoutRendezvousWaitingResponse
  | ScoutRendezvousMatchedResponse
  | ScoutRendezvousTopicBusyResponse;

export function normalizeScoutRendezvousTopic(topic: string): string {
  return topic.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function validateScoutRendezvousTopic(topic: unknown): string {
  if (typeof topic !== "string") {
    throw new Error("topic must be a string");
  }
  const displayTopic = topic.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!displayTopic) {
    throw new Error("topic must not be blank");
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(displayTopic)) {
    throw new Error("topic must not contain control characters");
  }
  if ([...displayTopic].length > SCOUT_RENDEZVOUS_MAX_TOPIC_CODE_POINTS) {
    throw new Error(
      `topic must be at most ${SCOUT_RENDEZVOUS_MAX_TOPIC_CODE_POINTS} characters`,
    );
  }
  return displayTopic;
}
