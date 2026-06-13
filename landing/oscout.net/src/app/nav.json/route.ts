import { getAllDocs, getNavigation } from "@/lib/docs";

export const dynamic = "force-static";

export function GET() {
  const docs = getAllDocs();
  const navigation = getNavigation();

  return Response.json({
    name: "OpenScout Docs",
    description: "Machine-readable docs navigation for agents and tools.",
    entrypoints: {
      agents: "/agents.md",
      llms: "/llms.txt",
      llmsFull: "/llms-full.txt",
      install: "/install.md",
      docs: "/docs",
    },
    groups: navigation.map((group) => ({
      title: group.title,
      items: group.items.map((item) => {
        const doc = docs.find((candidate) => candidate.slug === item.id);

        return {
          slug: item.id,
          title: item.title,
          description: item.description,
          url: `/docs/${item.id}`,
          sourcePath: doc?.sourcePath,
          sourceUrl: doc?.sourceUrl,
          rawUrl: doc?.rawUrl,
        };
      }),
    })),
  });
}
