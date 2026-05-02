import { describe, expect, test } from "bun:test";

import {
  normalizeLocalHostname,
  normalizeLocalHostnameLabel,
  resolveConfiguredScoutWebHostname,
  resolveScoutWebMdnsHostname,
  resolveScoutWebNamedHostname,
  resolveScoutWebVirtualHostname,
} from "./local-config.ts";

describe("local web hostnames", () => {
  test("derives the machine mDNS hostname from the machine hostname", () => {
    expect(resolveScoutWebMdnsHostname("hudson-mini")).toBe("hudson-mini.local");
    expect(resolveScoutWebMdnsHostname("Hudson-Mini.local")).toBe("hudson-mini.local");
  });

  test("derives the Scout virtual host for an edge proxy", () => {
    expect(resolveScoutWebVirtualHostname("hudson-mini")).toBe("hudson-mini.scout.local");
    expect(resolveScoutWebVirtualHostname("Hudson-Mini.local")).toBe("hudson-mini.scout.local");
  });

  test("derives user-defined Scout names", () => {
    expect(resolveScoutWebNamedHostname("m1")).toBe("m1.scout.local");
    expect(resolveScoutWebNamedHostname("m1.local")).toBe("m1.local");
    expect(resolveScoutWebNamedHostname("scout.m1.local")).toBe("scout.m1.local");
    expect(resolveScoutWebNamedHostname("m1.scout.local")).toBe("m1.scout.local");
    expect(resolveScoutWebNamedHostname("Scout Local")).toBe("scout-local.scout.local");
  });

  test("prefers the configured web local name", () => {
    expect(resolveConfiguredScoutWebHostname({ version: 1, webLocalName: "m1" })).toBe("m1.scout.local");
    expect(resolveConfiguredScoutWebHostname({ version: 1, webLocalName: "m1.scout.local" })).toBe("m1.scout.local");
  });

  test("defaults the Scout node host from the machine hostname", () => {
    expect(resolveConfiguredScoutWebHostname({ version: 1 }, "Arachs-Mac-mini.local")).toBe(
      "arachs-mac-mini.scout.local",
    );
  });

  test("normalizes hostnames into DNS labels", () => {
    expect(normalizeLocalHostnameLabel("Art's MacBook Pro.local")).toBe("art-s-macbook-pro");
    expect(normalizeLocalHostnameLabel("mini.office.example")).toBe("mini");
    expect(normalizeLocalHostnameLabel("")).toBe("localhost");
    expect(normalizeLocalHostname("Scout M1.local")).toBe("scout-m1.local");
    expect(normalizeLocalHostname("Scout.M1.local")).toBe("scout.m1.local");
  });
});
