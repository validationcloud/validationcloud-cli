export const installStdoutErrorHandler = (): void => {
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      // Exiting immediately prevents repeated EPIPE writes in closed pipelines.
      // eslint-disable-next-line unicorn/no-process-exit
      process.exit(0);
    }
    throw error;
  });
};
