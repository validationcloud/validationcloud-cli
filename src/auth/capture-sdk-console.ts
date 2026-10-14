const CAPTURED_METHODS = ["log", "info", "warn", "error", "debug", "dir", "trace"] as const;

type CapturedMethod = (typeof CAPTURED_METHODS)[number];

export type CapturedRun<T> =
  | { status: "fulfilled"; value: T; suppressedCount: number }
  | { status: "rejected"; reason: unknown; suppressedCount: number };

type Counter = { count: number };

const activeCounters = new Set<Counter>();
let originals: Record<CapturedMethod, Console[CapturedMethod]> | undefined;

function install(): void {
  if (originals !== undefined) return;
  originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    dir: console.dir,
    trace: console.trace,
  };
  for (const method of CAPTURED_METHODS) {
    console[method] = () => {
      for (const counter of activeCounters) counter.count += 1;
    };
  }
}

function uninstall(): void {
  if (originals === undefined || activeCounters.size > 0) return;
  for (const method of CAPTURED_METHODS) console[method] = originals[method];
  originals = undefined;
}

// The SDK logs raw token-endpoint bodies through console; callers report one sanitized line instead.
export async function withSdkConsoleCaptured<T>(fn: () => Promise<T>): Promise<CapturedRun<T>> {
  const counter: Counter = { count: 0 };
  install();
  activeCounters.add(counter);
  try {
    const value = await fn();
    return { status: "fulfilled", value, suppressedCount: counter.count };
  } catch (error) {
    return { status: "rejected", reason: error, suppressedCount: counter.count };
  } finally {
    activeCounters.delete(counter);
    uninstall();
  }
}
