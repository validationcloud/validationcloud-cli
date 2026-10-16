// A test-controlled hold on a response: `arrived` settles when the first request is held, `release` lets every held and later request through.
export type Gate = { arrived: Promise<undefined>; release: () => void };

export function createGate(): Gate & { hold: () => Promise<void> } {
  const arrival = Promise.withResolvers<undefined>();
  const opening = Promise.withResolvers<undefined>();
  return {
    arrived: arrival.promise,
    release() {
      opening.resolve(undefined);
    },
    async hold() {
      arrival.resolve(undefined);
      await opening.promise;
    },
  };
}
