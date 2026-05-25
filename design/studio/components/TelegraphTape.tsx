/**
 * TelegraphTape — backward-compat re-export shim.
 *
 * The reusable ticker primitive moved to `components/Ticker.tsx` once
 * it grew quick-steer behavior + a generalized action vocabulary. The
 * Telegraph study and the HUD chrome study still import the old name;
 * this shim keeps them working with zero churn.
 *
 * New code should import directly from `@/components/Ticker`.
 */

export {
  Ticker as TelegraphTape,
  type TickerEvent as TelegraphEvent,
  type TickerKind as TelegraphKind,
  type TickerProps as TelegraphTapeProps,
} from "@/components/Ticker";
