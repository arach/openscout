import { loadUserConfig, saveUserConfig, resolveOperatorName } from "@openscout/runtime/user-config";
import type { ScoutCommandContext } from "../context.ts";

export async function runConfigCommand(_context: ScoutCommandContext, args: string[]): Promise<void> {
  const [subcommand, key, ...rest] = args;

  if (subcommand === "set" && key === "name" && rest.length > 0) {
    const name = rest.join(" ").trim();
    const config = loadUserConfig();
    config.name = name;
    saveUserConfig(config);
    console.log(`Name set to: ${name}`);
    return;
  }

  if (subcommand === "get" && key === "name") {
    console.log(resolveOperatorName());
    return;
  }

  if (subcommand === "set" && key === "name") {
    // Clear the name
    const config = loadUserConfig();
    delete config.name;
    saveUserConfig(config);
    console.log(`Name reset to default: ${resolveOperatorName()}`);
    return;
  }

  if (!subcommand || subcommand === "show") {
    const config = loadUserConfig();
    const name = resolveOperatorName();
    console.log(`name: ${name}${config.name ? "" : " (default)"}`);
    return;
  }

  console.error("usage: scout config [show]");
  console.error("       scout config set name <value>");
  console.error("       scout config get name");
  process.exit(1);
}
