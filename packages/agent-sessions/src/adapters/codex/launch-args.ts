function normalizeCodexModelValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeCodexReasoningEffortValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function encodeCodexModelConfig(model: string): string {
  return `model=${JSON.stringify(model)}`;
}

function encodeCodexReasoningEffortConfig(reasoningEffort: string): string {
  return `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`;
}

function parseCodexConfigValue(value: string | null | undefined, expectedKey: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  if (key !== expectedKey) {
    return null;
  }

  const rawValue = trimmed.slice(separatorIndex + 1).trim();
  if (!rawValue) {
    return null;
  }

  if (
    (rawValue.startsWith("\"") && rawValue.endsWith("\""))
    || (rawValue.startsWith("'") && rawValue.endsWith("'"))
  ) {
    return rawValue.slice(1, -1) || null;
  }

  return rawValue;
}

function parseCodexModelConfig(value: string | null | undefined): string | null {
  return parseCodexConfigValue(value, "model");
}

function parseCodexReasoningEffortConfig(value: string | null | undefined): string | null {
  return parseCodexConfigValue(value, "model_reasoning_effort");
}

export function normalizeCodexAppServerLaunchArgs(launchArgs?: string[]): string[] {
  const args = Array.isArray(launchArgs)
    ? launchArgs.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const normalized: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (current === "--model" || current === "-m") {
      const model = normalizeCodexModelValue(args[index + 1]);
      if (model) {
        normalized.push("-c", encodeCodexModelConfig(model));
        index += 1;
        continue;
      }
      normalized.push(current);
      continue;
    }

    if (current.startsWith("--model=")) {
      const model = normalizeCodexModelValue(current.slice("--model=".length));
      if (model) {
        normalized.push("-c", encodeCodexModelConfig(model));
        continue;
      }
    }

    if (current.startsWith("-m=")) {
      const model = normalizeCodexModelValue(current.slice(3));
      if (model) {
        normalized.push("-c", encodeCodexModelConfig(model));
        continue;
      }
    }

    if (current === "--reasoning-effort" || current === "--effort") {
      const reasoningEffort = normalizeCodexReasoningEffortValue(args[index + 1]);
      if (reasoningEffort) {
        normalized.push("-c", encodeCodexReasoningEffortConfig(reasoningEffort));
        index += 1;
        continue;
      }
      normalized.push(current);
      continue;
    }

    if (current.startsWith("--reasoning-effort=")) {
      const reasoningEffort = normalizeCodexReasoningEffortValue(current.slice("--reasoning-effort=".length));
      if (reasoningEffort) {
        normalized.push("-c", encodeCodexReasoningEffortConfig(reasoningEffort));
        continue;
      }
    }

    if (current.startsWith("--effort=")) {
      const reasoningEffort = normalizeCodexReasoningEffortValue(current.slice("--effort=".length));
      if (reasoningEffort) {
        normalized.push("-c", encodeCodexReasoningEffortConfig(reasoningEffort));
        continue;
      }
    }

    if (current === "-c" || current === "--config") {
      const next = args[index + 1];
      if (typeof next === "string") {
        const model = parseCodexModelConfig(next);
        const reasoningEffort = parseCodexReasoningEffortConfig(next);
        normalized.push(
          current === "--config" ? "--config" : "-c",
          model
            ? encodeCodexModelConfig(model)
            : reasoningEffort
              ? encodeCodexReasoningEffortConfig(reasoningEffort)
              : next,
        );
        index += 1;
        continue;
      }
    }

    if (current.startsWith("--config=")) {
      const value = current.slice("--config=".length);
      const model = parseCodexModelConfig(value);
      const reasoningEffort = parseCodexReasoningEffortConfig(value);
      normalized.push(
        model
          ? `--config=${encodeCodexModelConfig(model)}`
          : reasoningEffort
            ? `--config=${encodeCodexReasoningEffortConfig(reasoningEffort)}`
            : current,
      );
      continue;
    }

    normalized.push(current);
  }

  return normalized;
}

export function readCodexAppServerModelFromLaunchArgs(launchArgs?: string[]): string | null {
  const normalized = normalizeCodexAppServerLaunchArgs(launchArgs);

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? "";
    if (current === "-c" || current === "--config") {
      const model = parseCodexModelConfig(normalized[index + 1]);
      if (model) {
        return model;
      }
      index += 1;
      continue;
    }

    if (current.startsWith("--config=")) {
      const model = parseCodexModelConfig(current.slice("--config=".length));
      if (model) {
        return model;
      }
    }
  }

  return null;
}

export function readCodexAppServerReasoningEffortFromLaunchArgs(launchArgs?: string[]): string | null {
  const normalized = normalizeCodexAppServerLaunchArgs(launchArgs);

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index] ?? "";
    if (current === "-c" || current === "--config") {
      const reasoningEffort = parseCodexReasoningEffortConfig(normalized[index + 1]);
      if (reasoningEffort) {
        return reasoningEffort;
      }
      index += 1;
      continue;
    }

    if (current.startsWith("--config=")) {
      const reasoningEffort = parseCodexReasoningEffortConfig(current.slice("--config=".length));
      if (reasoningEffort) {
        return reasoningEffort;
      }
    }
  }

  return null;
}
