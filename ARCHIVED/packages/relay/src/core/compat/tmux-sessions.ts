import { execFileSync } from "node:child_process";

export function listTmuxSessionsSync(): string[] {
  try {
    return execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function hasTmuxSessionSync(sessionName: string): boolean {
  return listTmuxSessionsSync().includes(sessionName);
}

export function killTmuxSessionSync(sessionName: string): boolean {
  if (!hasTmuxSessionSync(sessionName)) {
    return false;
  }

  try {
    execFileSync("tmux", ["kill-session", "-t", sessionName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}
