import { get, list, put } from "@vercel/blob";

export type OpenScoutIntentCapture = {
  id: string;
  email: string;
  intent?: string;
  interest?: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  submissions: number;
};

export type OpenScoutIntentCaptureSubmission = {
  email: string;
  intent?: string;
  interest?: string;
  source?: string;
  honeypot?: string;
};

const INTENT_CAPTURES_PREFIX = "intent-captures/";
const DEFAULT_CAPTURE_SOURCE = "landing";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  const email = sanitizeString(value)?.toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return undefined;
  }
  return email;
}

function encodeEmailKey(email: string): string {
  return Buffer.from(email).toString("base64url");
}

function intentCapturePath(email: string): string {
  return `${INTENT_CAPTURES_PREFIX}${encodeEmailKey(email)}.json`;
}

export function normalizeOpenScoutIntentCaptureSubmission(
  input: unknown,
): OpenScoutIntentCaptureSubmission | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Record<string, unknown>;
  const email = normalizeEmail(candidate.email);
  if (!email) {
    return null;
  }

  return {
    email,
    intent: sanitizeString(candidate.intent),
    interest: sanitizeString(candidate.interest),
    source: sanitizeString(candidate.source),
    honeypot: sanitizeString(candidate.honeypot),
  };
}

export function normalizeOpenScoutIntentCapture(input: unknown): OpenScoutIntentCapture | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<OpenScoutIntentCapture>;
  const id = sanitizeString(candidate.id);
  const email = normalizeEmail(candidate.email);
  const source = sanitizeString(candidate.source);
  const createdAt = sanitizeString(candidate.createdAt);
  const updatedAt = sanitizeString(candidate.updatedAt);
  const submissions = typeof candidate.submissions === "number" && Number.isFinite(candidate.submissions)
    ? Math.max(1, Math.trunc(candidate.submissions))
    : undefined;

  if (!id || !email || !source || !createdAt || !updatedAt || !submissions) {
    return null;
  }

  return {
    id,
    email,
    intent: sanitizeString(candidate.intent),
    interest: sanitizeString(candidate.interest),
    source,
    createdAt,
    updatedAt,
    submissions,
  };
}

async function readBlobJson(pathname: string): Promise<OpenScoutIntentCapture | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) {
    return null;
  }

  const raw = await new Response(result.stream).text();
  const parsed = JSON.parse(raw) as unknown;
  return normalizeOpenScoutIntentCapture(parsed);
}

export async function getOpenScoutIntentCapture(email: string): Promise<OpenScoutIntentCapture | null> {
  return readBlobJson(intentCapturePath(email));
}

export async function storeOpenScoutIntentCapture(capture: OpenScoutIntentCapture) {
  return put(intentCapturePath(capture.email), JSON.stringify(capture, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

export async function upsertOpenScoutIntentCapture(
  submission: OpenScoutIntentCaptureSubmission,
): Promise<{ capture: OpenScoutIntentCapture; existing: boolean }> {
  const email = normalizeEmail(submission.email);
  if (!email) {
    throw new Error("A valid email address is required");
  }

  const existing = await getOpenScoutIntentCapture(email);
  const now = new Date().toISOString();
  const capture: OpenScoutIntentCapture = existing
    ? {
        ...existing,
        intent: submission.intent ?? existing.intent,
        interest: submission.interest ?? existing.interest,
        source: submission.source ?? existing.source,
        updatedAt: now,
        submissions: existing.submissions + 1,
      }
    : {
        id: crypto.randomUUID(),
        email,
        intent: submission.intent,
        interest: submission.interest,
        source: submission.source ?? DEFAULT_CAPTURE_SOURCE,
        createdAt: now,
        updatedAt: now,
        submissions: 1,
      };

  await storeOpenScoutIntentCapture(capture);

  return {
    capture,
    existing: existing !== null,
  };
}

export async function listOpenScoutIntentCaptures(limit = 200): Promise<OpenScoutIntentCapture[]> {
  const listed = await list({
    prefix: INTENT_CAPTURES_PREFIX,
    limit,
  });

  const captures = await Promise.all(
    listed.blobs.map(async (blob) => readBlobJson(blob.pathname)),
  );

  return captures
    .filter((capture): capture is OpenScoutIntentCapture => capture !== null)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}
