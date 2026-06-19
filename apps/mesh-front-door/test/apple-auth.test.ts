import { afterEach, beforeEach, expect, test } from "bun:test";

import { __resetAppleJwksCacheForTests, verifyAppleIdentityToken } from "../src/apple-auth.js";

const KID = "test-apple-key";
const AUDIENCE = "com.openscout.scout";
const NOW = 1_750_000_000_000; // fixed reference time for deterministic exp checks

let keyPair: CryptoKeyPair;
let jwks: { keys: unknown[] };

beforeEach(async () => {
  __resetAppleJwksCacheForTests();
  keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey) as Record<string, unknown>;
  jwks = { keys: [{ kty: "RSA", kid: KID, alg: "RS256", use: "sig", n: publicJwk.n, e: publicJwk.e }] };
});

afterEach(() => {
  __resetAppleJwksCacheForTests();
});

test("verifies a well-formed Apple identity token", async () => {
  const token = await mintToken({ exp: NOW / 1000 + 600, nonce: "n-123" });
  const result = await verifyAppleIdentityToken(token, {
    audiences: [AUDIENCE],
    expectedNonce: "n-123",
    fetcher: jwksFetch,
    now: NOW,
  });
  expect(result).toEqual({
    ok: true,
    identity: { sub: "0011.apple.user", email: "person@example.com", emailVerified: true },
  });
});

test("treats email_verified string 'true' as verified", async () => {
  const token = await mintToken({ exp: NOW / 1000 + 600, email_verified: "true" });
  const result = await verifyAppleIdentityToken(token, { audiences: [AUDIENCE], fetcher: jwksFetch, now: NOW });
  expect(result.ok && result.identity.emailVerified).toBe(true);
});

test("rejects an expired token", async () => {
  const token = await mintToken({ exp: NOW / 1000 - 3600 });
  const result = await verifyAppleIdentityToken(token, { audiences: [AUDIENCE], fetcher: jwksFetch, now: NOW });
  expect(result).toMatchObject({ ok: false, reason: "apple_token_expired" });
});

test("rejects a token for a different audience", async () => {
  const token = await mintToken({ exp: NOW / 1000 + 600, aud: "com.someone.else" });
  const result = await verifyAppleIdentityToken(token, { audiences: [AUDIENCE], fetcher: jwksFetch, now: NOW });
  expect(result).toMatchObject({ ok: false, reason: "apple_bad_audience" });
});

test("rejects a nonce mismatch", async () => {
  const token = await mintToken({ exp: NOW / 1000 + 600, nonce: "real-nonce" });
  const result = await verifyAppleIdentityToken(token, {
    audiences: [AUDIENCE],
    expectedNonce: "attacker-nonce",
    fetcher: jwksFetch,
    now: NOW,
  });
  expect(result).toMatchObject({ ok: false, reason: "apple_nonce_mismatch" });
});

test("rejects a tampered signature", async () => {
  const token = await mintToken({ exp: NOW / 1000 + 600 });
  const tampered = token.slice(0, -4) + (token.endsWith("AAAA") ? "BBBB" : "AAAA");
  const result = await verifyAppleIdentityToken(tampered, { audiences: [AUDIENCE], fetcher: jwksFetch, now: NOW });
  expect(result).toMatchObject({ ok: false });
  expect(result.ok).toBe(false);
});

test("rejects a token signed by an unknown key", async () => {
  const token = await mintToken({ exp: NOW / 1000 + 600, kid: "some-other-kid" });
  const result = await verifyAppleIdentityToken(token, { audiences: [AUDIENCE], fetcher: jwksFetch, now: NOW });
  expect(result).toMatchObject({ ok: false, reason: "apple_unknown_key" });
});

// --- helpers -------------------------------------------------------------

async function jwksFetch(): Promise<Response> {
  return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
}

interface TokenOverrides {
  exp: number;
  aud?: string;
  nonce?: string;
  email_verified?: boolean | string;
  kid?: string;
}

async function mintToken(overrides: TokenOverrides): Promise<string> {
  const header = { alg: "RS256", kid: overrides.kid ?? KID };
  const claims: Record<string, unknown> = {
    iss: "https://appleid.apple.com",
    aud: overrides.aud ?? AUDIENCE,
    sub: "0011.apple.user",
    email: "person@example.com",
    email_verified: overrides.email_verified ?? true,
    iat: NOW / 1000 - 10,
    exp: overrides.exp,
  };
  if (overrides.nonce !== undefined) claims.nonce = overrides.nonce;

  const headerSegment = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadSegment = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
