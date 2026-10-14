export function summarizeDescription(description: string): string {
  const firstLine = description.trim().split("\n")[0] ?? "";
  const sentenceEnd = firstLine.search(/\.(?:\s|$)/u);
  return sentenceEnd === -1 ? firstLine : firstLine.slice(0, sentenceEnd + 1);
}
