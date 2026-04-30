import { describe, expect, test } from "bun:test";

import { resolveOpenScoutWebApplicationServerIdentity } from "./app-server-origin.ts";

describe("resolveOpenScoutWebApplicationServerIdentity", () => {
  test("uses scout.<hostname>.local as the default advertised host", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity({}, "Hudson-Mini.local"),
    ).toEqual({
      advertisedHost: "scout.hudson-mini.local",
      publicOrigin: undefined,
      trustedHosts: ["scout.hudson-mini.local"],
      trustedOrigins: [],
    });
  });

  test("trusts the public origin host and explicit trusted hosts", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity(
        {
          OPENSCOUT_WEB_PUBLIC_ORIGIN: "https://scout.hudson-mini.local",
          OPENSCOUT_WEB_TRUSTED_HOSTS: "scout.backup.local, 192.168.1.20",
          OPENSCOUT_WEB_TRUSTED_ORIGINS: "http://scout.backup.local:3200",
        },
        "hudson-mini",
      ),
    ).toEqual({
      advertisedHost: "scout.hudson-mini.local",
      publicOrigin: "https://scout.hudson-mini.local",
      trustedHosts: [
        "scout.hudson-mini.local",
        "scout.backup.local",
        "192.168.1.20",
      ],
      trustedOrigins: [
        "https://scout.hudson-mini.local",
        "http://scout.backup.local:3200",
      ],
    });
  });
});
