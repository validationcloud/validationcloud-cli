export type LockOwnerState = "alive" | "dead" | "unknown";

export type LockObservation = {
  owner: LockOwnerState;
  modifiedAtMs: number;
};

export function isLockStale(
  observation: LockObservation,
  nowMs: number,
  staleAfterMs: number,
): boolean {
  if (observation.owner === "dead") return true;
  // The owner refreshes the lock's mtime while it works, so a long-unmodified lock belongs to a frozen or recycled pid.
  return nowMs - observation.modifiedAtMs > staleAfterMs;
}
