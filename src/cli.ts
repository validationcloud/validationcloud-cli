import { installStdoutErrorHandler } from "#cli/install-stdout-error-handler";
import { runCli } from "#cli/run-cli";

installStdoutErrorHandler();

process.exitCode = await runCli(process.argv.slice(2), {
  processEnv: process.env,
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});
