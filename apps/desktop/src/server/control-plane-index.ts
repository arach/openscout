import { createScoutControlPlaneServer } from "./create-scout-control-plane-server.ts";

const port = Number(process.env.OPENSCOUT_WEB_PORT ?? process.env.SCOUT_WEB_PORT ?? "3200");
const hostname = process.env.SCOUT_WEB_HOST?.trim()
  || process.env.OPENSCOUT_WEB_HOST?.trim()
  || "127.0.0.1";
const currentDirectory = process.env.OPENSCOUT_SETUP_CWD?.trim() || process.cwd();

const { app, warmupCaches } = createScoutControlPlaneServer({
  currentDirectory,
  assetMode: "static",
});

export default {
  port,
  hostname,
  idleTimeout: 30,
  fetch: app.fetch,
};

console.log(`Scout → http://${hostname}:${port}`);
void warmupCaches();
