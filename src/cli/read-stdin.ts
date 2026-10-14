import { text } from "node:stream/consumers";

export function readStdin(): Promise<string> {
  return text(process.stdin);
}
