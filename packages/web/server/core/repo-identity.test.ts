import { describe, expect, test } from "bun:test";

import { normalizeGitRemoteUrl } from "./repo-identity.ts";

describe("normalizeGitRemoteUrl", () => {
  test("collapses ssh and https remotes to one canonical key", () => {
    const ssh = normalizeGitRemoteUrl("git@github.com:arach/openscout.git");
    expect(normalizeGitRemoteUrl("https://github.com/arach/openscout")).toBe(ssh);
    expect(normalizeGitRemoteUrl("https://github.com/arach/openscout.git")).toBe(ssh);
    expect(ssh).toBe("github.com/arach/openscout");
  });

  test("normalizes hosts while preserving nested owner paths", () => {
    expect(normalizeGitRemoteUrl("git@GitHub.COM:Arach/OpenScout.git")).toBe(
      "github.com/Arach/OpenScout",
    );
    expect(normalizeGitRemoteUrl("https://gitlab.com/org/team/repo.git")).toBe(
      "gitlab.com/org/team/repo",
    );
  });

  test("handles explicit ssh URLs", () => {
    expect(normalizeGitRemoteUrl("ssh://git@github.com/arach/openscout.git")).toBe(
      "github.com/arach/openscout",
    );
  });

  test("rejects local paths and empty input", () => {
    expect(normalizeGitRemoteUrl("/Users/art/dev/openscout")).toBeNull();
    expect(normalizeGitRemoteUrl("../relative/clone")).toBeNull();
    expect(normalizeGitRemoteUrl("")).toBeNull();
    expect(normalizeGitRemoteUrl(null)).toBeNull();
  });
});
