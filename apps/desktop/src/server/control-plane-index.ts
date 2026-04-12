import { createScoutControlPlaneServer } from "./create-scout-control-plane-server.ts";

const port = Number(process.env.SCOUT_WEB_PORT ?? "3200");
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();

const { app, warmupCaches } = createScoutControlPlaneServer({
  currentDirectory,
  assetMode: "static",
});

export default {
  port,
  idleTimeout: 30,
  fetch: app.fetch,
};

console.log(`Scout → http://localhost:${port}`);
void warmupCaches();
