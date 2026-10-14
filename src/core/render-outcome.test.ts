import { describe, expect, it } from "vitest";
import { renderOutcome } from "./render-outcome.ts";

describe("renderOutcome", () => {
  describe("with --json", () => {
    it("prints structured content as compact JSON when not on a terminal", () => {
      expect(
        renderOutcome(
          { kind: "structured", value: { chains: ["eth"] } },
          { json: true, pretty: false },
        ),
      ).toBe('{"chains":["eth"]}\n');
    });

    it("pretty-prints structured content on a terminal", () => {
      expect(
        renderOutcome({ kind: "structured", value: { a: 1 } }, { json: true, pretty: true }),
      ).toBe('{\n  "a": 1\n}\n');
    });

    it("parses JSON text content", () => {
      expect(
        renderOutcome({ kind: "text", text: '{"ok": true}' }, { json: true, pretty: false }),
      ).toBe('{"ok":true}\n');
    });

    it("wraps plain text content as a JSON string", () => {
      expect(
        renderOutcome({ kind: "text", text: "hello\nworld" }, { json: true, pretty: false }),
      ).toBe('"hello\\nworld"\n');
    });

    it("prints null for an empty result", () => {
      expect(renderOutcome({ kind: "empty" }, { json: true, pretty: false })).toBe("null\n");
    });
  });

  describe("without --json", () => {
    it("formats structured content for humans", () => {
      expect(
        renderOutcome(
          { kind: "structured", value: { status: "ok", region: "eu" } },
          { json: false, pretty: true },
        ),
      ).toBe("status\tok\nregion\teu\n");
    });

    it("prints text content as is with a trailing newline", () => {
      expect(
        renderOutcome({ kind: "text", text: "plain answer" }, { json: false, pretty: false }),
      ).toBe("plain answer\n");
    });

    it("keeps an existing trailing newline in text content", () => {
      expect(renderOutcome({ kind: "text", text: "line\n" }, { json: false, pretty: false })).toBe(
        "line\n",
      );
    });

    it("prints nothing for an empty result", () => {
      expect(renderOutcome({ kind: "empty" }, { json: false, pretty: false })).toBe("");
    });
  });
});
