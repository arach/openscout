import { indexRecentSessionKnowledge, SQLiteKnowledgeStore } from "@openscout/runtime";

/**
 * Child-process entrypoint for /api/knowledge/sessions/index. Session
 * indexing parses hundreds of MB of transcripts and performs heavy SQLite/FTS
 * writes; running it in a separate process keeps the web server's event loop
 * (and memory footprint) isolated from the job — a crash or OOM here cannot
 * take the server down. Options arrive as JSON in argv[2]; the outcome is
 * printed as a single JSON line on stdout.
 */
async function main() {
  const input = JSON.parse(process.argv[2] ?? "{}") as {
    days?: number;
    limit?: number;
    force?: boolean;
  };
  try {
    const result = await indexRecentSessionKnowledge(input);
    const store = new SQLiteKnowledgeStore();
    try {
      console.log(JSON.stringify({ ok: true, result, status: store.status() }));
    } finally {
      store.close();
    }
  } catch (error) {
    console.log(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    process.exitCode = 1;
  }
}

await main();
