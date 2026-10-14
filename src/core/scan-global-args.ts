export type GlobalArgsScan = {
  firstToken: string | undefined;
  wantsHelp: boolean;
  wantsVersion: boolean;
  wantsJson: boolean;
};

export function scanGlobalArgs(argv: readonly string[]): GlobalArgsScan {
  let firstToken: string | undefined;
  let wantsHelp = false;
  let wantsVersion = false;
  let wantsJson = false;
  // A leading flag the root command does not know is a usage error, so what follows it is not a tool namespace.
  let sawUnknownLeadingFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") break;
    if (arg === "--input") {
      // The next token is the value, even when it looks like a flag.
      index += 1;
    } else if (arg === "-h" || arg === "--help") {
      wantsHelp = true;
    } else if (arg === "-V" || arg === "--version") {
      wantsVersion = true;
    } else if (arg === "--json") {
      wantsJson = true;
    } else if (arg.startsWith("-")) {
      sawUnknownLeadingFlag ||= firstToken === undefined;
    } else if (firstToken === undefined && !sawUnknownLeadingFlag) {
      firstToken = arg;
    }
  }
  return { firstToken, wantsHelp, wantsVersion, wantsJson };
}
