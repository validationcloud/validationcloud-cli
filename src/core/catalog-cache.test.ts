import { expect, describe, it } from "vitest";
import { catalogFreshness } from "./catalog-cache.ts";

const HOUR_MS = 3_600_000;

describe("catalogFreshness", () => {
  const cache = { fetchedAtMs: 1_000_000, principal: "user-1" };

  it.each([
    ["just fetched", 1_000_000, "user-1", "fresh"],
    ["one millisecond before the TTL", 1_000_000 + HOUR_MS - 1, "user-1", "fresh"],
    ["exactly at the TTL", 1_000_000 + HOUR_MS, "user-1", "stale"],
    ["long after the TTL", 1_000_000 + 10 * HOUR_MS, "user-1", "stale"],
    ["fetched in the future", 500_000, "user-1", "fresh"],
    ["another principal while fresh", 1_000_000, "user-2", "foreign"],
    ["another principal while stale", 1_000_000 + 10 * HOUR_MS, "user-2", "foreign"],
  ])("%s -> %s", (_label, nowMs, principal, expected) => {
    expect(catalogFreshness(cache, nowMs, principal)).toBe(expected);
  });
});
