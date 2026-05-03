export interface OpenScoutAuthEnv {
  OPENSCOUT_GITHUB_CLIENT_ID?: string;
  OPENSCOUT_GITHUB_CLIENT_SECRET?: string;
  OPENSCOUT_GITHUB_REDIRECT_URI?: string;
  OPENSCOUT_SESSION_SECRET?: string;
  OPENSCOUT_SESSION_TTL_SECONDS?: string;
}

export interface OpenScoutSession {
  provider: "github";
  providerUserId: string;
  login: string;
  email: string;
  expiresAt: number;
}

interface GitHubUser {
  id: number;
  login: string;
  email?: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility?: string | null;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface OAuthState {
  nonce: string;
  returnTo: string;
  expiresAt: number;
}

type Fetcher = typeof fetch;

const GITHUB_OAUTH_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_USER_URL = "https://api.github.com/user";
const GITHUB_API_EMAILS_URL = "https://api.github.com/user/emails";
const GITHUB_API_VERSION = "2022-11-28";

const OPENSCOUT_GITHUB_OAUTH_SCOPE = "user:email";
const OPENSCOUT_NATIVE_AUTH_RETURN_TO = "/v1/auth/native/complete";
const OPENSCOUT_IOS_AUTH_CALLBACK_URL = "openscout://osn-auth";
const OPENSCOUT_SESSION_COOKIE = "osn_session";
const OPENSCOUT_OAUTH_STATE_COOKIE = "osn_oauth_state";
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
const USER_AGENT = "OpenScout Mesh Front Door";

export async function handleOpenScoutAuthRequest(
  request: Request,
  env: OpenScoutAuthEnv,
  fetcher: Fetcher = fetch,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "GET" && url.pathname === "/v1/auth/github/start") {
    return startGitHubOAuth(request, env);
  }

  if (method === "GET" && url.pathname === "/v1/auth/github/callback") {
    return finishGitHubOAuth(request, env, fetcher);
  }

  if (method === "GET" && url.pathname === "/v1/auth/session") {
    const session = await readOpenScoutSessionFromRequest(request, env);
    return json(200, session ? { authenticated: true, session: publicSession(session) } : { authenticated: false });
  }

  if (method === "POST" && url.pathname === "/v1/auth/logout") {
    return json(200, { ok: true }, [clearCookie(OPENSCOUT_SESSION_COOKIE, request.url)]);
  }

  return undefined;
}

export async function readOpenScoutSessionFromRequest(
  request: Request,
  env: OpenScoutAuthEnv,
): Promise<OpenScoutSession | undefined> {
  const token = readBearerSessionToken(request) ?? readCookie(request, OPENSCOUT_SESSION_COOKIE);
  if (!token) return undefined;

  const session = await verifySignedToken<OpenScoutSession>(token, env.OPENSCOUT_SESSION_SECRET);
  if (!session || session.provider !== "github" || session.expiresAt <= Date.now()) {
    return undefined;
  }
  if (!isNonEmptyString(session.providerUserId) || !isNonEmptyString(session.login) || !isNonEmptyString(session.email)) {
    return undefined;
  }
  return session;
}

async function startGitHubOAuth(request: Request, env: OpenScoutAuthEnv): Promise<Response> {
  const clientId = readGitHubClientId(env);
  if (!clientId) return json(500, { error: "github_oauth_not_configured", detail: "missing client id" });
  if (!env.OPENSCOUT_SESSION_SECRET?.trim()) return json(500, { error: "session_secret_not_configured" });

  const url = new URL(request.url);
  const redirectUri = readRedirectUri(request, env);
  const returnTo = sanitizeReturnTo(url.searchParams.get("return_to"));
  const state: OAuthState = {
    nonce: randomToken(),
    returnTo,
    expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
  };
  const stateToken = await signToken(state, env.OPENSCOUT_SESSION_SECRET);

  const authorizeURL = new URL(GITHUB_OAUTH_AUTHORIZE_URL);
  authorizeURL.searchParams.set("client_id", clientId);
  authorizeURL.searchParams.set("redirect_uri", redirectUri);
  authorizeURL.searchParams.set("scope", OPENSCOUT_GITHUB_OAUTH_SCOPE);
  authorizeURL.searchParams.set("state", state.nonce);
  authorizeURL.searchParams.set("allow_signup", "true");

  return redirect(authorizeURL, [
    cookie(OPENSCOUT_OAUTH_STATE_COOKIE, stateToken, request.url, {
      maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    }),
  ]);
}

async function finishGitHubOAuth(request: Request, env: OpenScoutAuthEnv, fetcher: Fetcher): Promise<Response> {
  const clientId = readGitHubClientId(env);
  const clientSecret = readGitHubClientSecret(env);
  if (!clientId || !clientSecret) return json(500, { error: "github_oauth_not_configured" });

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim();
  const state = url.searchParams.get("state")?.trim();
  if (!code || !state) return json(400, { error: "missing_oauth_code_or_state" });

  const stateToken = readCookie(request, OPENSCOUT_OAUTH_STATE_COOKIE);
  const expectedState = await verifySignedToken<OAuthState>(stateToken, env.OPENSCOUT_SESSION_SECRET);
  if (!expectedState || expectedState.expiresAt <= Date.now() || expectedState.nonce !== state) {
    return json(400, { error: "invalid_oauth_state" }, [clearCookie(OPENSCOUT_OAUTH_STATE_COOKIE, request.url)]);
  }

  const accessToken = await exchangeGitHubCode(fetcher, {
    clientId,
    clientSecret,
    code,
    redirectUri: readRedirectUri(request, env),
  });
  if (!accessToken.ok) {
    return json(502, { error: "github_token_exchange_failed", detail: accessToken.detail });
  }

  const identity = await fetchGitHubIdentity(fetcher, accessToken.token);
  if (!identity.ok) {
    return json(identity.status, { error: identity.error, detail: identity.detail });
  }

  const now = Date.now();
  const ttlSeconds = readPositiveInteger(env.OPENSCOUT_SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
  const session: OpenScoutSession = {
    provider: "github",
    providerUserId: identity.user.id.toString(),
    login: identity.user.login,
    email: identity.email,
    expiresAt: now + ttlSeconds * 1000,
  };
  const sessionToken = await signToken(session, env.OPENSCOUT_SESSION_SECRET);

  if (expectedState.returnTo === OPENSCOUT_NATIVE_AUTH_RETURN_TO) {
    const callbackURL = new URL(OPENSCOUT_IOS_AUTH_CALLBACK_URL);
    callbackURL.searchParams.set("session", sessionToken);
    callbackURL.searchParams.set("expires_at", session.expiresAt.toString());
    return redirect(callbackURL, [
      clearCookie(OPENSCOUT_OAUTH_STATE_COOKIE, request.url),
    ]);
  }

  return redirect(new URL(expectedState.returnTo, url.origin), [
    clearCookie(OPENSCOUT_OAUTH_STATE_COOKIE, request.url),
    cookie(OPENSCOUT_SESSION_COOKIE, sessionToken, request.url, { maxAge: ttlSeconds }),
  ]);
}

async function exchangeGitHubCode(
  fetcher: Fetcher,
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<{ ok: true; token: string } | { ok: false; detail: string }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  const response = await fetcher(GITHUB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as GitHubTokenResponse;
  if (!response.ok || !payload.access_token) {
    return { ok: false, detail: payload.error_description ?? payload.error ?? `HTTP ${response.status}` };
  }
  return { ok: true, token: payload.access_token };
}

async function fetchGitHubIdentity(
  fetcher: Fetcher,
  accessToken: string,
): Promise<{ ok: true; user: GitHubUser; email: string } | { ok: false; status: number; error: string; detail?: string }> {
  const userResponse = await gitHubApi(fetcher, GITHUB_API_USER_URL, accessToken);
  if (!userResponse.ok) return { ok: false, status: 502, error: "github_user_fetch_failed", detail: `HTTP ${userResponse.status}` };
  const user = await userResponse.json() as GitHubUser;
  if (!Number.isFinite(user.id) || !isNonEmptyString(user.login)) {
    return { ok: false, status: 502, error: "github_user_invalid" };
  }

  const emailsResponse = await gitHubApi(fetcher, GITHUB_API_EMAILS_URL, accessToken);
  if (!emailsResponse.ok) {
    return { ok: false, status: 403, error: "github_email_unavailable", detail: "user:email scope is required" };
  }
  const emails = await emailsResponse.json() as GitHubEmail[];
  const primaryVerified = emails.find((email) => email.primary && email.verified && isNonEmptyString(email.email));
  const firstVerified = emails.find((email) => email.verified && isNonEmptyString(email.email));
  const email = primaryVerified?.email ?? firstVerified?.email;
  if (!email) {
    return { ok: false, status: 403, error: "github_verified_email_required" };
  }

  return { ok: true, user, email: email.toLowerCase() };
}

function gitHubApi(fetcher: Fetcher, url: string, accessToken: string): Promise<Response> {
  return fetcher(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": USER_AGENT,
      "x-github-api-version": GITHUB_API_VERSION,
    },
  });
}

async function signToken(payload: unknown, secret: string | undefined): Promise<string> {
  const normalizedSecret = secret?.trim();
  if (!normalizedSecret) throw new Error("missing session secret");
  const payloadSegment = base64URLFromBytes(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmac(payloadSegment, normalizedSecret);
  return `${payloadSegment}.${base64URLFromBytes(signature)}`;
}

async function verifySignedToken<T>(token: string | undefined, secret: string | undefined): Promise<T | undefined> {
  const normalizedSecret = secret?.trim();
  if (!token || !normalizedSecret) return undefined;
  const [payloadSegment, signatureSegment, extra] = token.split(".");
  if (!payloadSegment || !signatureSegment || extra !== undefined) return undefined;
  const expected = base64URLFromBytes(await hmac(payloadSegment, normalizedSecret));
  if (!constantTimeEqual(signatureSegment, expected)) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytesFromBase64URL(payloadSegment))) as T;
  } catch {
    return undefined;
  }
}

async function hmac(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function readBearerSessionToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer osn_session_")) return undefined;
  return authorization.slice("Bearer osn_session_".length);
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...valueParts] = part.trim().split("=");
    if (rawName === name) {
      return valueParts.join("=");
    }
  }
  return undefined;
}

function readRedirectUri(request: Request, env: OpenScoutAuthEnv): string {
  return env.OPENSCOUT_GITHUB_REDIRECT_URI?.trim() || new URL("/v1/auth/github/callback", request.url).toString();
}

function readGitHubClientId(env: OpenScoutAuthEnv): string | undefined {
  return env.OPENSCOUT_GITHUB_CLIENT_ID?.trim() || undefined;
}

function readGitHubClientSecret(env: OpenScoutAuthEnv): string | undefined {
  return env.OPENSCOUT_GITHUB_CLIENT_SECRET?.trim() || undefined;
}

function sanitizeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/v1/auth/session";
  return value;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64URLFromBytes(bytes);
}

function publicSession(session: OpenScoutSession): Omit<OpenScoutSession, "expiresAt"> & { expiresAt: string } {
  return {
    provider: session.provider,
    providerUserId: session.providerUserId,
    login: session.login,
    email: session.email,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

function cookie(name: string, value: string, requestURL: string, options: { maxAge: number }): string {
  const secure = new URL(requestURL).protocol === "https:" ? "; Secure" : "";
  return `${name}=${value}; Max-Age=${options.maxAge}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function clearCookie(name: string, requestURL: string): string {
  return cookie(name, "", requestURL, { maxAge: 0 });
}

function redirect(url: URL, cookies: string[] = []): Response {
  const headers = new Headers({ location: url.toString(), "cache-control": "no-store" });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 302, headers });
}

function json(status: number, payload: unknown, cookies: string[] = []): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(JSON.stringify(payload, null, 2), { status, headers });
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function base64URLFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function bytesFromBase64URL(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
