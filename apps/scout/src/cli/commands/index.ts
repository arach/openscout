import type { ScoutCommandContext } from "../context.ts";

export type ScoutCommandHandler = (context: ScoutCommandContext, args: string[]) => Promise<void>;

export type ScoutCommandName =
  | "ask"
  | "broadcast"
  | "card"
  | "down"
  | "doctor"
  | "enroll"
  | "env"
  | "pair"
  | "ps"
  | "restart"
  | "runtimes"
  | "send"
  | "setup"
  | "speak"
  | "up"
  | "watch"
  | "who";

export async function loadScoutCommandHandler(name: ScoutCommandName): Promise<ScoutCommandHandler> {
  switch (name) {
    case "ask":
      return (await import("./ask.ts")).runAskCommand;
    case "broadcast":
      return (await import("./broadcast.ts")).runBroadcastCommand;
    case "card":
      return (await import("./card.ts")).runCardCommand;
    case "down":
      return (await import("./down.ts")).runDownCommand;
    case "doctor":
      return (await import("./doctor.ts")).runDoctorCommand;
    case "enroll":
      return (await import("./enroll.ts")).runEnrollCommand;
    case "env":
      return (await import("./env.ts")).runEnvCommand;
    case "pair":
      return (await import("./pair.ts")).runPairCommand;
    case "ps":
      return (await import("./ps.ts")).runPsCommand;
    case "restart":
      return (await import("./restart.ts")).runRestartCommand;
    case "runtimes":
      return (await import("./runtimes.ts")).runRuntimesCommand;
    case "send":
      return (await import("./send.ts")).runSendCommand;
    case "setup":
      return (await import("./setup.ts")).runSetupCommand;
    case "speak":
      return (await import("./speak.ts")).runSpeakCommand;
    case "up":
      return (await import("./up.ts")).runUpCommand;
    case "watch":
      return (await import("./watch.ts")).runWatchCommand;
    case "who":
      return (await import("./who.ts")).runWhoCommand;
  }
}
