import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { link, mkdir, open, rm, utimes, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import * as z from "zod";
import { isLockStale } from "#core/decide-lock-staleness";
import type { LockOwnerState } from "#core/decide-lock-staleness";

const STALE_AFTER_MS = 30_000;
const RECOVERY_STALE_AFTER_MS = 5000;
const WAIT_BOUND_MS = 10_000;
const HEARTBEAT_MS = 5000;

const LockOwner = z.object({ pid: z.number().int(), acquiredAtMs: z.number(), nonce: z.string() });

type LockSnapshot = { content: string; owner: LockOwnerState; modifiedAtMs: number };

const heldLocks = new AsyncLocalStorage<ReadonlySet<string>>();

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function ownerState(content: string): LockOwnerState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return "unknown";
  }
  const owner = LockOwner.safeParse(parsed);
  if (!owner.success) return "unknown";
  if (owner.data.pid === process.pid) return "alive";
  try {
    process.kill(owner.data.pid, 0);
    return "alive";
  } catch (error) {
    return errorCode(error) === "ESRCH" ? "dead" : "alive";
  }
}

async function inspectLock(path: string): Promise<LockSnapshot | undefined> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
  try {
    const [content, stats] = await Promise.all([handle.readFile("utf8"), handle.stat()]);
    return { content, owner: ownerState(content), modifiedAtMs: stats.mtimeMs };
  } finally {
    await handle.close();
  }
}

// link() publishes the fully written owner record atomically and fails with EEXIST like O_EXCL.
async function tryCreate(path: string, content: string, nonce: string): Promise<boolean> {
  const temporaryPath = `${path}.${process.pid}.${nonce}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600, flag: "wx" });
    await link(temporaryPath, path);
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function removeIfOwned(path: string, content: string): Promise<void> {
  const current = await inspectLock(path);
  if (current?.content === content) await rm(path, { force: true });
}

function ownerRecord(): { content: string; nonce: string } {
  const nonce = randomBytes(16).toString("hex");
  return {
    content: JSON.stringify({ pid: process.pid, acquiredAtMs: Date.now(), nonce }),
    nonce,
  };
}

// Recoverers serialize on a second lock and re-check under it, so two of them can never both remove a lock.
async function breakStaleLock(lockPath: string, staleContent: string): Promise<boolean> {
  const recoveryPath = `${lockPath}.recovery`;
  const record = ownerRecord();
  if (!(await tryCreate(recoveryPath, record.content, record.nonce))) {
    const recovery = await inspectLock(recoveryPath);
    if (recovery !== undefined && isLockStale(recovery, Date.now(), RECOVERY_STALE_AFTER_MS)) {
      await removeIfOwned(recoveryPath, recovery.content);
    }
    return false;
  }
  try {
    const current = await inspectLock(lockPath);
    if (current?.content !== staleContent) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    await removeIfOwned(recoveryPath, record.content);
  }
}

// A missed heartbeat only shortens the lease; the critical section reports its own errors.
async function touchLock(lockPath: string): Promise<void> {
  const now = new Date();
  try {
    await utimes(lockPath, now, now);
  } catch {
    // The lease simply ages from the previous touch.
  }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const record = ownerRecord();
  const deadline = Date.now() + WAIT_BOUND_MS;
  while (!(await tryCreate(lockPath, record.content, record.nonce))) {
    const current = await inspectLock(lockPath);
    if (current === undefined) continue;
    if (
      isLockStale(current, Date.now(), STALE_AFTER_MS) &&
      (await breakStaleLock(lockPath, current.content))
    ) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `timed out after ${WAIT_BOUND_MS / 1000} s waiting for the credentials lock ${lockPath}; another vcloud process holds it (delete the file if no vcloud process is running)`,
      );
    }
    await sleep(10 + Math.floor(Math.random() * 40));
  }
  const heartbeat = setInterval(() => {
    void touchLock(lockPath);
  }, HEARTBEAT_MS);
  heartbeat.unref();
  return async () => {
    clearInterval(heartbeat);
    await removeIfOwned(lockPath, record.content);
  };
}

export async function withCredentialsLock<T>(
  credentialsPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = `${credentialsPath}.lock`;
  const held = heldLocks.getStore();
  if (held?.has(lockPath) === true) return fn();
  const release = await acquireLock(lockPath);
  try {
    return await heldLocks.run(new Set([...(held ?? []), lockPath]), fn);
  } finally {
    await release();
  }
}
