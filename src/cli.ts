import { exitAfterFlush } from "#cli/exit-after-flush";
import { installStdoutErrorHandler } from "#cli/install-stdout-error-handler";
import { runCli } from "#cli/run-cli";

installStdoutErrorHandler();

const exitCode = await runCli(process.argv.slice(2), {
  processEnv: process.env,
  execArgv: process.execArgv,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});
await exitAfterFlush(exitCode);
