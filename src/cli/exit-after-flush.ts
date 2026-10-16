// An empty write completes only after every earlier write to the stream has been flushed, even into a slow pipe.
function flushed(stream: NodeJS.WriteStream): Promise<void> {
  if (stream.writableLength === 0) return Promise.resolve();
  return new Promise((resolve) => {
    stream.write("", () => {
      resolve();
    });
  });
}

// Exiting explicitly keeps a socket that undici leaves open to a broken proxy from holding the process alive.
export async function exitAfterFlush(exitCode: number): Promise<never> {
  // The stdout EPIPE handler exits with this code when the reader has gone away.
  process.exitCode = exitCode;
  await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(exitCode);
}
