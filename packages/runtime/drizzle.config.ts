import { defineConfig } from "drizzle-kit";

// Initial Drizzle spike: only the deliveries proof path is modeled in Drizzle
// today. The full control-plane schema still lives in CONTROL_PLANE_SQLITE_SCHEMA.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
