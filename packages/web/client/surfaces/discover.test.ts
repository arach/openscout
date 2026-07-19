import { describe, expect, test } from "bun:test";
import { buildSurfaceRegistry } from "./discover-build.ts";
import { defineSurface } from "./types.ts";

function mockScreen() {
  return null;
}

const brokerSurface = defineSurface({
  id: "dispatch",
  label: "Dispatch",
  route: { view: "broker" },
  webPath: "/dispatch",
  screen: "BrokerScreen",
  embed: {
    path: "/embed/dispatch",
    profile: "macos.dispatch",
  },
});

const lanesSurface = defineSurface({
  id: "lanes",
  label: "Lanes",
  route: { view: "ops", mode: "lanes" },
  webPath: "/ops/lanes",
  screen: "AgentLanesView",
  embed: {
    path: "/embed/agent-lanes",
    aliases: ["/ops/lanes/embed", "/embed/lanes"],
    profile: "macos.lanes",
  },
});

const projectsSurface = defineSurface({
  id: "projects",
  label: "Projects",
  route: { view: "agents-v2" },
  webPath: "/projects",
  screen: "ProjectsEmbedScreen",
  embed: {
    path: "/embed/projects",
    profile: "macos.projects",
  },
});

describe("embeddable surface discovery", () => {
  const { surfaces, embedByPath } = buildSurfaceRegistry({
    "../screens/broker/BrokerScreen.tsx": {
      scoutSurface: brokerSurface,
      BrokerScreen: mockScreen,
    },
    "../screens/ops/AgentLanesView.tsx": {
      scoutSurface: lanesSurface,
      AgentLanesView: mockScreen,
    },
    "../screens/projects/ProjectsScreen.tsx": {
      scoutSurface: projectsSurface,
      ProjectsEmbedScreen: mockScreen,
    },
  });

  test("discovers dispatch, lanes, and projects from screen modules", () => {
    const ids = surfaces.map((surface) => surface.id).sort();
    expect(ids).toEqual(["dispatch", "lanes", "projects"]);
    expect(surfaces.find((surface) => surface.id === "dispatch")?.webPath).toBe("/dispatch");
  });

  test("embed paths and aliases are unique", () => {
    const paths = surfaces.flatMap((surface) => surface.embedPaths);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("resolves canonical and legacy embed paths", () => {
    expect(embedByPath.get("/embed/dispatch")?.id).toBe("dispatch");
    expect(embedByPath.get("/embed/agent-lanes")?.id).toBe("lanes");
    expect(embedByPath.get("/ops/lanes/embed")?.id).toBe("lanes");
    expect(embedByPath.get("/embed/projects")?.id).toBe("projects");
  });
});
