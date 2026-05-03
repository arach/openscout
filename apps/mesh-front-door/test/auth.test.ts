import { describe, expect, test } from "bun:test";

import { handleOpenScoutAuthRequest } from "../src/auth.js";
import { resolveMeshFrontDoorAuth } from "../src/rendezvous.js";

describe("mesh front door GitHub auth", () => {
  test("starts GitHub OAuth with only the email scope", async () => {
    const response = await handleOpenScoutAuthRequest(
      new Request("https://mesh.oscout.net/v1/auth/github/start?return_to=/mesh"),
      {
        OPENSCOUT_GITHUB_CLIENT_ID: "github-client",
        OPENSCOUT_SESSION_SECRET: "test-secret",
      },
    );

    expect(response?.status).toBe(302);
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("client_id")).toBe("github-client");
    expect(location.searchParams.get("redirect_uri")).toBe("https://mesh.oscout.net/v1/auth/github/callback");
    expect(location.searchParams.get("scope")).toBe("user:email");
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(response?.headers.get("set-cookie")).toContain("osn_oauth_state=");
  });

  test("finishes GitHub OAuth without retaining the GitHub access token", async () => {
    const env = {
      OPENSCOUT_GITHUB_CLIENT_ID: "github-client",
      OPENSCOUT_GITHUB_CLIENT_SECRET: "github-secret",
      OPENSCOUT_SESSION_SECRET: "test-secret",
      OPENSCOUT_SESSION_TTL_SECONDS: "3600",
    };
    const start = await handleOpenScoutAuthRequest(
      new Request("https://mesh.oscout.net/v1/auth/github/start?return_to=/mesh"),
      env,
    );
    const stateCookie = readCookie(start, "osn_oauth_state");
    const state = new URL(start?.headers.get("location") ?? "").searchParams.get("state");

    const callback = await handleOpenScoutAuthRequest(
      new Request(`https://mesh.oscout.net/v1/auth/github/callback?code=oauth-code&state=${state}`, {
        headers: { cookie: `osn_oauth_state=${stateCookie}` },
      }),
      env,
      mockGitHubFetch,
    );

    expect(callback?.status).toBe(302);
    expect(callback?.headers.get("location")).toBe("https://mesh.oscout.net/mesh");
    const sessionCookie = readCookie(callback, "osn_session");
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie).not.toContain("github-token");

    const session = await handleOpenScoutAuthRequest(
      new Request("https://mesh.oscout.net/v1/auth/session", {
        headers: { cookie: `osn_session=${sessionCookie}` },
      }),
      env,
    );
    expect(session?.status).toBe(200);
    await expect(session?.json()).resolves.toMatchObject({
      authenticated: true,
      session: {
        provider: "github",
        providerUserId: "42",
        login: "arach",
        email: "arach@example.com",
      },
    });

    const auth = await resolveMeshFrontDoorAuth(
      new Request("https://mesh.oscout.net/v1/nodes", {
        headers: { cookie: `osn_session=${sessionCookie}` },
      }),
      env,
    );
    expect(auth).toEqual({
      key: "github:42",
      label: "arach@example.com",
      kind: "github_user",
    });
  });

  test("finishes native GitHub OAuth with an iOS callback session", async () => {
    const env = {
      OPENSCOUT_GITHUB_CLIENT_ID: "github-client",
      OPENSCOUT_GITHUB_CLIENT_SECRET: "github-secret",
      OPENSCOUT_SESSION_SECRET: "test-secret",
      OPENSCOUT_SESSION_TTL_SECONDS: "3600",
    };
    const start = await handleOpenScoutAuthRequest(
      new Request("https://mesh.oscout.net/v1/auth/github/start?return_to=/v1/auth/native/complete"),
      env,
    );
    const stateCookie = readCookie(start, "osn_oauth_state");
    const state = new URL(start?.headers.get("location") ?? "").searchParams.get("state");

    const callback = await handleOpenScoutAuthRequest(
      new Request(`https://mesh.oscout.net/v1/auth/github/callback?code=oauth-code&state=${state}`, {
        headers: { cookie: `osn_oauth_state=${stateCookie}` },
      }),
      env,
      mockGitHubFetch,
    );

    expect(callback?.status).toBe(302);
    const location = new URL(callback?.headers.get("location") ?? "");
    expect(location.protocol).toBe("openscout:");
    expect(location.host).toBe("osn-auth");
    expect(location.searchParams.get("session")).toBeTruthy();
    expect(location.searchParams.get("expires_at")).toBeTruthy();
    expect(readCookie(callback, "osn_session")).toBe("");

    const session = await handleOpenScoutAuthRequest(
      new Request("https://mesh.oscout.net/v1/auth/session", {
        headers: { authorization: `Bearer osn_session_${location.searchParams.get("session")}` },
      }),
      env,
    );
    await expect(session?.json()).resolves.toMatchObject({
      authenticated: true,
      session: {
        providerUserId: "42",
        login: "arach",
        email: "arach@example.com",
      },
    });
  });
});

async function mockGitHubFetch(input: RequestInfo | URL): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (url === "https://github.com/login/oauth/access_token") {
    return json(200, { access_token: "github-token" });
  }
  if (url === "https://api.github.com/user") {
    return json(200, { id: 42, login: "arach", email: null });
  }
  if (url === "https://api.github.com/user/emails") {
    return json(200, [
      { email: "secondary@example.com", primary: false, verified: true },
      { email: "Arach@Example.com", primary: true, verified: true },
    ]);
  }
  return json(404, { error: "unexpected fetch", url });
}

function readCookie(response: Response | undefined, name: string): string {
  const header = response?.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${name}=([^;,]+)`).exec(header);
  return match?.[1] ?? "";
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
