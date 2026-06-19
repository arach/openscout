import { beforeEach, expect, test } from "bun:test";

import { handleOpenScoutAuthRequest } from "../src/auth.js";
import { __resetAppleJwksCacheForTests } from "../src/apple-auth.js";
import { resolveMeshFrontDoorAuth } from "../src/rendezvous.js";

const KID = "test-apple-key";
const BUNDLE_ID = "com.openscout.scout";

const env = {
  OPENSCOUT_SESSION_SECRET: "test-secret",
  OPENSCOUT_SESSION_TTL_SECONDS: "3600",
  OPENSCOUT_APPLE_CLIENT_IDS: `${BUNDLE_ID}, com.openscout.scout.web`,
};

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

test("mints an OSN session from a native Apple identity token", async () => {
  const identityToken = await mintToken({ nonce: "nonce-xyz" });
  const response = await handleOpenScoutAuthRequest(
    appleNativeRequest({ identityToken, nonce: "nonce-xyz", fullName: "Arach T" }),
    env,
    jwksFetch,
  );

  expect(response?.status).toBe(200);
  const body = await response?.json() as { session: string; expires_at: number };
  expect(body.session).toBeTruthy();
  expect(body.expires_at).toBeGreaterThan(Date.now());

  // The minted session is accepted as a Bearer token and resolves to an apple_user.
  const session = await handleOpenScoutAuthRequest(
    new Request("https://mesh.oscout.net/v1/auth/session", {
      headers: { authorization: `Bearer osn_session_${body.session}` },
    }),
    env,
  );
  await expect(session?.json()).resolves.toMatchObject({
    authenticated: true,
    session: { provider: "apple", providerUserId: "0011.apple.user", login: "Arach T", email: "person@example.com" },
  });

  const auth = await resolveMeshFrontDoorAuth(
    new Request("https://mesh.oscout.net/v1/nodes", {
      headers: { authorization: `Bearer osn_session_${body.session}` },
    }),
    env,
  );
  expect(auth).toEqual({ key: "apple:0011.apple.user", label: "person@example.com", kind: "apple_user" });
});

test("falls back to the email local part when no name is supplied", async () => {
  const identityToken = await mintToken({});
  const response = await handleOpenScoutAuthRequest(appleNativeRequest({ identityToken }), env, jwksFetch);
  const body = await response?.json() as { session: string };
  const session = await handleOpenScoutAuthRequest(
    new Request("https://mesh.oscout.net/v1/auth/session", {
      headers: { authorization: `Bearer osn_session_${body.session}` },
    }),
    env,
  );
  await expect(session?.json()).resolves.toMatchObject({ session: { login: "person" } });
});

test("rejects a token whose nonce does not match the submitted nonce", async () => {
  const identityToken = await mintToken({ nonce: "real" });
  const response = await handleOpenScoutAuthRequest(
    appleNativeRequest({ identityToken, nonce: "spoofed" }),
    env,
    jwksFetch,
  );
  expect(response?.status).toBe(401);
  await expect(response?.json()).resolves.toMatchObject({ error: "apple_nonce_mismatch" });
});

test("returns 400 when the identity token is missing", async () => {
  const response = await handleOpenScoutAuthRequest(appleNativeRequest({}), env, jwksFetch);
  expect(response?.status).toBe(400);
  await expect(response?.json()).resolves.toMatchObject({ error: "missing_identity_token" });
});

test("returns 500 when no Apple audiences are configured", async () => {
  const identityToken = await mintToken({});
  const response = await handleOpenScoutAuthRequest(
    appleNativeRequest({ identityToken }),
    { OPENSCOUT_SESSION_SECRET: "test-secret" },
    jwksFetch,
  );
  expect(response?.status).toBe(500);
  await expect(response?.json()).resolves.toMatchObject({ error: "apple_auth_not_configured" });
});

// --- helpers -------------------------------------------------------------

function appleNativeRequest(body: Record<string, unknown>): Request {
  return new Request("https://mesh.oscout.net/v1/auth/apple/native", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function jwksFetch(input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (url === "https://appleid.apple.com/auth/keys") {
    return new Response(JSON.stringify(jwks), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ error: "unexpected fetch", url }), { status: 404 });
}

async function mintToken(overrides: { nonce?: string }): Promise<string> {
  const header = { alg: "RS256", kid: KID };
  const claims: Record<string, unknown> = {
    iss: "https://appleid.apple.com",
    aud: BUNDLE_ID,
    sub: "0011.apple.user",
    email: "person@example.com",
    email_verified: "true",
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 600,
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
