/**
 * Types shared between the web and mobile DB query surfaces.
 *
 * Web-specific shapes live in `./web.ts`, mobile-specific shapes in
 * `./mobile.ts`. Internal-only SQL helper types stay in
 * `../internal/sql-helpers.ts`.
 */

export type HeartrateBucket = { ts: number; count: number; value: number };
