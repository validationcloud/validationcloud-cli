import { describe, expect, it } from "vitest";
import { isLockStale } from "./decide-lock-staleness.ts";

describe("isLockStale", () => {
  it("treats a lock whose owner process is gone as stale at once", () => {
    expect(isLockStale({ owner: "dead", modifiedAtMs: 1_000_000 }, 1_000_001, 30_000)).toBe(true);
  });

  it("keeps a fresh lock held by a live owner", () => {
    expect(isLockStale({ owner: "alive", modifiedAtMs: 1_000_000 }, 1_029_000, 30_000)).toBe(false);
  });

  it("keeps a live owner's lock at exactly the stale bound", () => {
    expect(isLockStale({ owner: "alive", modifiedAtMs: 1_000_000 }, 1_030_000, 30_000)).toBe(false);
  });

  it("breaks a live owner's lock once it is older than the bound", () => {
    expect(isLockStale({ owner: "alive", modifiedAtMs: 1_000_000 }, 1_030_001, 30_000)).toBe(true);
  });

  it("keeps a fresh lock whose owner cannot be read", () => {
    expect(isLockStale({ owner: "unknown", modifiedAtMs: 1_000_000 }, 1_005_000, 30_000)).toBe(
      false,
    );
  });

  it("breaks an unreadable lock once it is older than the bound", () => {
    expect(isLockStale({ owner: "unknown", modifiedAtMs: 1_000_000 }, 1_031_000, 30_000)).toBe(
      true,
    );
  });

  it("keeps a lock whose mtime lies in the future", () => {
    expect(isLockStale({ owner: "alive", modifiedAtMs: 2_000_000 }, 1_000_000, 30_000)).toBe(false);
  });
});
