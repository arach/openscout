// Sign in with Apple identity-token verification.
//
// The native iOS flow hands us the `identityToken` Apple minted for the app — a
// signed JWT (RS256). We verify it ourselves against Apple's published public
// keys; there is no token exchange and no client secret, so this needs no
// Apple `.p8` key on the server. The token's `aud` is the app's bundle id, which
// is the only Apple-side configuration the server has to know about.
//
// Kept deliberately dependency-light (WebCrypto only) to match auth.ts.

export interface AppleAuthEnv {
  // Comma-separated list of accepted audiences (token `aud`). For the native
  // flow this is the app bundle id, e.g. "com.openscout.scout". A web Services
  // ID can be added later as an additional value.
  OPENSCOUT_APPLE_CLIENT_IDS?: string;
}

export interface AppleIdentity {
  sub: string;
  email?: string;
  emailVerified: boolean;
}

export type AppleVerifyResult =
  | { ok: true; identity: AppleIdentity }
  | { ok: false; reason: string; detail?: string };

interface VerifyOptions {
  /** Accepted audiences (token `aud`). At least one required. */
  audiences: string[];
  /** If provided, the token's `nonce` claim must match exactly. */
  expectedNonce?: string;
  /** Injectable for tests. */
  fetcher?: typeof fetch;
  /** Injectable for tests; defaults to Date.now(). */
  now?: number;
}

interface AppleJWK {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n: string;
  e: string;
}

interface JWTHeader {
  alg: string;
  kid?: string;
}

interface AppleClaims {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
}

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const CLOCK_SKEW_MS = 5 * 60_000;
const JWKS_CACHE_TTL_MS = 60 * 60_000;

interface CachedJwks {
  keys: AppleJWK[];
  fetchedAt: number;
}

let jwksCache: CachedJwks | undefined;

export function parseAppleClientIds(env: AppleAuthEnv): string[] {
  return (env.OPENSCOUT_APPLE_CLIENT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export async function verifyAppleIdentityToken(
  idToken: string,
  options: VerifyOptions,
): Promise<AppleVerifyResult> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();

  if (options.audiences.length === 0) {
    return { ok: false, reason: "apple_audience_not_configured" };
  }

  const segments = idToken.split(".");
  if (segments.length !== 3) {
    return { ok: false, reason: "apple_token_malformed" };
  }
  const [headerSegment, payloadSegment, signatureSegment] = segments;

  let header: JWTHeader;
  let claims: AppleClaims;
  try {
    header = JSON.parse(decodeUtf8(bytesFromBase64URL(headerSegment))) as JWTHeader;
    claims = JSON.parse(decodeUtf8(bytesFromBase64URL(payloadSegment))) as AppleClaims;
  } catch {
    return { ok: false, reason: "apple_token_undecodable" };
  }

  if (header.alg !== "RS256") {
    return { ok: false, reason: "apple_unexpected_alg", detail: header.alg };
  }
  if (!header.kid) {
    return { ok: false, reason: "apple_missing_kid" };
  }

  const jwk = await resolveAppleKey(header.kid, fetcher, now);
  if (!jwk) {
    return { ok: false, reason: "apple_unknown_key" };
  }

  const verified = await verifyRs256(`${headerSegment}.${payloadSegment}`, signatureSegment, jwk);
  if (!verified) {
    return { ok: false, reason: "apple_bad_signature" };
  }

  if (claims.iss !== APPLE_ISSUER) {
    return { ok: false, reason: "apple_bad_issuer", detail: claims.iss };
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!audiences.some((aud) => options.audiences.includes(aud))) {
    return { ok: false, reason: "apple_bad_audience", detail: audiences.join(",") };
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 + CLOCK_SKEW_MS <= now) {
    return { ok: false, reason: "apple_token_expired" };
  }
  if (typeof claims.iat === "number" && claims.iat * 1000 - CLOCK_SKEW_MS > now) {
    return { ok: false, reason: "apple_token_future" };
  }
  if (options.expectedNonce !== undefined && claims.nonce !== options.expectedNonce) {
    return { ok: false, reason: "apple_nonce_mismatch" };
  }
  if (typeof claims.sub !== "string" || claims.sub.trim().length === 0) {
    return { ok: false, reason: "apple_missing_subject" };
  }

  const email = typeof claims.email === "string" && claims.email.trim().length > 0
    ? claims.email.trim().toLowerCase()
    : undefined;
  // Apple sends email_verified as the string "true"/"false" in some flows.
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";

  return {
    ok: true,
    identity: { sub: claims.sub, email, emailVerified },
  };
}

async function resolveAppleKey(kid: string, fetcher: typeof fetch, now: number): Promise<AppleJWK | undefined> {
  const cached = jwksCache;
  const fresh = cached && now - cached.fetchedAt < JWKS_CACHE_TTL_MS;
  if (fresh) {
    const hit = cached!.keys.find((key) => key.kid === kid);
    if (hit) return hit;
  }

  const keys = await fetchAppleJwks(fetcher);
  if (keys) {
    jwksCache = { keys, fetchedAt: now };
    return keys.find((key) => key.kid === kid);
  }

  // Network failure: fall back to a stale cache rather than locking everyone out.
  return cached?.keys.find((key) => key.kid === kid);
}

async function fetchAppleJwks(fetcher: typeof fetch): Promise<AppleJWK[] | undefined> {
  try {
    const response = await fetcher(APPLE_JWKS_URL, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const payload = await response.json() as { keys?: AppleJWK[] };
    if (!Array.isArray(payload.keys)) return undefined;
    return payload.keys.filter((key) => key.kty === "RSA" && typeof key.kid === "string");
  } catch {
    return undefined;
  }
}

async function verifyRs256(signingInput: string, signatureSegment: string, jwk: AppleJWK): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = bytesFromBase64URL(signatureSegment);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      new TextEncoder().encode(signingInput),
    );
  } catch {
    return false;
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesFromBase64URL(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// Exposed only so tests can reset the module-level JWKS cache between cases.
export function __resetAppleJwksCacheForTests(): void {
  jwksCache = undefined;
}
