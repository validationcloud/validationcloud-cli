import { err, ok } from "./result.ts";
import type { Result } from "./result.ts";

export type RequestTimeouts = {
  // Probe, connect and tools/list: they only move small documents.
  setupMs: number;
  // tools/call: the gateway lets mavrik run for 5 minutes downstream, so the CLI waits a little longer than that.
  toolCallMs: number;
  // Each request of a token refresh, made while the credentials lock is held.
  refreshMs: number;
};

const DEFAULT_TIMEOUTS: RequestTimeouts = {
  setupMs: 60_000,
  toolCallMs: 330_000,
  refreshMs: 20_000,
};

// setTimeout treats anything above this as 1 ms.
const MAX_REQUEST_TIMEOUT_MS = 2_147_483_647;

// VC_REQUEST_TIMEOUT_MS replaces all three defaults with one value.
export function resolveRequestTimeouts(raw: string | undefined): Result<RequestTimeouts> {
  if (raw === undefined || raw === "") return ok(DEFAULT_TIMEOUTS);
  const milliseconds = /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!(milliseconds >= 1 && milliseconds <= MAX_REQUEST_TIMEOUT_MS)) {
    return err(
      `VC_REQUEST_TIMEOUT_MS must be a whole number of milliseconds between 1 and ${MAX_REQUEST_TIMEOUT_MS}`,
    );
  }
  return ok({ setupMs: milliseconds, toolCallMs: milliseconds, refreshMs: milliseconds });
}
