const unsettledSections = new Set<Promise<void>>();

async function quietly(section: Promise<unknown>): Promise<void> {
  try {
    await section;
  } catch {
    // The caller of the section reports its error.
  }
}

async function forgetWhenDone(done: Promise<void>): Promise<void> {
  await done;
  unsettledSections.delete(done);
}

export function trackLockSection(section: Promise<unknown>): void {
  const done = quietly(section);
  unsettledSections.add(done);
  void forgetWhenDone(done);
}

// A process that exits while a section runs can leave a rotated refresh token unsaved and the lock file behind.
export async function settleCredentialsLocks(): Promise<void> {
  while (unsettledSections.size > 0) await Promise.all(unsettledSections);
}
