import { describe, expect, test } from "bun:test";

import { resolveOpenScoutWebApplicationServerIdentity } from "./app-server-origin.ts";

describe("resolveOpenScoutWebApplicationServerIdentity", () => {
  test("uses scout.local as the portal and a node host as the advertised host", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity({}, "Hudson-Mini.local", { webLocalName: "m1.scout.local" }),
    ).toEqual({
      advertisedHost: "m1.scout.local",
      portalHost: "scout.local",
      publicOrigin: undefined,
      trustedHosts: ["m1.scout.local", "scout.local"],
      trustedOrigins: [],
    });
  });

  test("trusts the public origin host and explicit trusted hosts", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity(
        {
          OPENSCOUT_WEB_PUBLIC_ORIGIN: "https://scout.local",
          OPENSCOUT_WEB_TRUSTED_HOSTS: "scout.backup.local, 192.168.1.20",
          OPENSCOUT_WEB_TRUSTED_ORIGINS: "http://scout.backup.local:3200",
        },
        "hudson-mini",
        { webLocalName: "m1.scout.local" },
      ),
    ).toEqual({
      advertisedHost: "m1.scout.local",
      portalHost: "scout.local",
      publicOrigin: "https://scout.local",
      trustedHosts: [
        "m1.scout.local",
        "scout.local",
        "scout.backup.local",
        "192.168.1.20",
      ],
      trustedOrigins: [
        "https://scout.local",
        "http://scout.backup.local:3200",
      ],
    });
  });

  test("uses configured web local name without changing the machine name", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity(
        {},
        "Arachs-Mac-mini.local",
        { webLocalName: "m1.scout.local" },
      ),
    ).toEqual({
      advertisedHost: "m1.scout.local",
      portalHost: "scout.local",
      publicOrigin: undefined,
      trustedHosts: ["m1.scout.local", "scout.local"],
      trustedOrigins: [],
    });
  });

  test("uses environment web local name", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity(
        { OPENSCOUT_WEB_LOCAL_NAME: "m1" },
        "Arachs-Mac-mini.local",
      ).advertisedHost,
    ).toBe("m1.scout.local");
  });

  test("defaults node host from the machine hostname under scout.local", () => {
    expect(
      resolveOpenScoutWebApplicationServerIdentity(
        {},
        "Arachs-Mac-mini.local",
        {},
      ),
    ).toMatchObject({
      advertisedHost: "arachs-mac-mini.scout.local",
      portalHost: "scout.local",
      trustedHosts: ["arachs-mac-mini.scout.local", "scout.local"],
    });
  });
});
