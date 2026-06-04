import { readObservedProviderBudgetObservations } from "../budget-common.js";
import type {
  AdapterBudgetObservationInput,
  AdapterBudgetObservations,
} from "../../protocol/budget-observations.js";

export function readClaudeCodeBudgetObservations(
  input: AdapterBudgetObservationInput,
  now = Date.now(),
): AdapterBudgetObservations {
  return readObservedProviderBudgetObservations(input, {
    provider: "anthropic",
    includeQuotaWindows: false,
    usageMetadataSource: "claude-code.providerMeta.observeUsage",
  }, now);
}
