import { api } from "./api.ts";

export type OperatorAttentionDismissTarget =
  | {
      recordKind: "work_item";
      recordId: string;
      itemUpdatedAt: number;
    }
  | {
      flightId: string;
      itemUpdatedAt: number;
    };

export async function dismissOperatorAttention(target: OperatorAttentionDismissTarget): Promise<void> {
  await api("/api/operator-attention/dismiss", {
    method: "POST",
    body: JSON.stringify(target),
  });
}
