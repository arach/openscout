import { loadUserConfig, saveUserConfig, resolveOperatorHandle, resolveOperatorName } from "@openscout/runtime/user-config";
import { saveOpenScoutOnboardingIdentity } from "@openscout/runtime/onboarding";
import type { ScoutCommandContext } from "../context.ts";
import { defaultScoutContextDirectory } from "../context.ts";

export async function runConfigCommand(context: ScoutCommandContext, args: string[]): Promise<void> {
  const [subcommand, key, ...rest] = args;

  if (subcommand === "set" && (key === "name" || key === "handle") && rest.length > 0) {
    const value = rest.join(" ").trim();
    const config = loadUserConfig();
    config[key] = value;
    saveUserConfig(config);
    if (key === "name") {
      await saveOpenScoutOnboardingIdentity({
        currentDirectory: defaultScoutContextDirectory(context),
        name: value,
      });
    }
    console.log(`${key === "name" ? "Name" : "Handle"} set to: ${value}`);
    return;
  }

  if (subcommand === "get" && (key === "name" || key === "handle")) {
    console.log(key === "name" ? resolveOperatorName() : resolveOperatorHandle());
    return;
  }

  if (subcommand === "set" && (key === "name" || key === "handle")) {
    const config = loadUserConfig();
    delete config[key];
    saveUserConfig(config);
    const fallback = key === "name" ? resolveOperatorName() : resolveOperatorHandle();
    console.log(`${key === "name" ? "Name" : "Handle"} reset to default: ${fallback}`);
    return;
  }

  if (!subcommand || subcommand === "show") {
    const config = loadUserConfig();
    const name = resolveOperatorName();
    const handle = resolveOperatorHandle();
    console.log(`name: ${name}${config.name ? "" : " (default)"}`);
    console.log(`handle: @${handle}${config.handle ? "" : " (default)"}`);
    return;
  }

  console.error("usage: scout config [show]");
  console.error("       scout config set name <value>");
  console.error("       scout config set handle <value>");
  console.error("       scout config get name");
  console.error("       scout config get handle");
  process.exit(1);
}
