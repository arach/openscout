import { expect, test } from "bun:test";

import { getScoutMobileRuntimeCapabilities } from "./service.ts";

test("mobile runtime capabilities expose the versioned legal tuple catalog", async () => {
  const catalog = await getScoutMobileRuntimeCapabilities();
  expect(catalog.schemaVersion).toBe("openscout.runtime-capabilities.v1");
  expect(catalog.harnesses.map((harness) => harness.id)).toContain("codex");
  expect(catalog.models.some((model) => (
    model.id === "gpt-5.6-sol" && model.harnesses.includes("codex")
  ))).toBe(true);
  expect(catalog.efforts.find((effort) => effort.id === "ultra")?.harnesses).toEqual(["codex"]);
});
