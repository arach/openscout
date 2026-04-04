import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const packageDir = import.meta.dir;
const rootDir = path.resolve(packageDir, "..", "..");
const outdir = path.join(
  rootDir,
  "native/engine/Sources/ScoutApp/Resources/RelayWeb"
);

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [path.join(packageDir, "src/main.tsx")],
  outdir,
  target: "browser",
  format: "iife",
  minify: false,
  splitting: false,
  sourcemap: "external",
  naming: {
    entry: "relay.[ext]",
    chunk: "relay-[name].[ext]",
    asset: "relay.[ext]",
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }

  process.exit(1);
}

const scripts = result.outputs
  .map((output) => path.basename(output.path))
  .filter((name) => name.endsWith(".js"))
  .sort();

const styles = result.outputs
  .map((output) => path.basename(output.path))
  .filter((name) => name.endsWith(".css"))
  .sort();

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>OpenScout Relay</title>
    ${styles.map((style) => `    <link rel="stylesheet" href="./${style}" />`).join("\n")}
  </head>
  <body>
    <div id="root"></div>
    ${scripts.map((script) => `    <script src="./${script}"></script>`).join("\n")}
  </body>
</html>
`;

await writeFile(path.join(outdir, "relay.html"), html, "utf8");
