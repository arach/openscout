import { describe, expect, test } from "bun:test";

import {
  normalizeLocalHostnameLabel,
  resolveScoutWebMdnsHostname,
} from "./local-config.ts";

describe("local web hostnames", () => {
  test("derives the Scout mDNS hostname from the machine hostname", () => {
    expect(resolveScoutWebMdnsHostname("hudson-mini")).toBe("scout.hudson-mini.local");
    expect(resolveScoutWebMdnsHostname("Hudson-Mini.local")).toBe("scout.hudson-mini.local");
  });

  test("normalizes hostnames into DNS labels", () => {
    expect(normalizeLocalHostnameLabel("Art's MacBook Pro.local")).toBe("art-s-macbook-pro");
    expect(normalizeLocalHostnameLabel("mini.office.example")).toBe("mini");
    expect(normalizeLocalHostnameLabel("")).toBe("localhost");
  });
});
