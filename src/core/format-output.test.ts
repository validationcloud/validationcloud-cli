import { describe, expect, it } from "vitest";
import { formatHuman, formatJson, formatText } from "./format-output.ts";

describe("formatHuman", () => {
  describe("array of objects", () => {
    it("renders a table with an uppercase header and flattened dot-path columns", () => {
      expect(
        formatHuman([
          { id: 1, name: "alpha", usage: { cu: 10, calls: 2 } },
          { id: 2, name: "beta", usage: { cu: 20, calls: 4 } },
        ]),
      ).toBe("ID\tNAME\tUSAGE.CU\tUSAGE.CALLS\n1\talpha\t10\t2\n2\tbeta\t20\t4\n");
    });

    it("unions columns across rows and leaves missing and null cells empty", () => {
      expect(formatHuman([{ a: 1 }, { b: 2, a: null }])).toBe("A\tB\n1\t\n\t2\n");
    });

    it("renders nested arrays and empty objects as JSON in a cell", () => {
      expect(formatHuman([{ tags: ["x", "y"], meta: {}, items: [{ n: 1 }] }])).toBe(
        'TAGS\tMETA\tITEMS\n["x","y"]\t{}\t[{"n":1}]\n',
      );
    });

    it("escapes tabs and newlines inside string cells", () => {
      expect(formatHuman([{ text: "a\tb\nc\r" }])).toBe("TEXT\na\\tb\\nc\\r\n");
    });

    it("renders booleans and zero as plain text", () => {
      expect(formatHuman([{ ok: true, off: false, n: 0 }])).toBe("OK\tOFF\tN\ntrue\tfalse\t0\n");
    });

    it("unwraps an object whose only value is an array of objects", () => {
      expect(formatHuman({ endpoints: [{ id: "a" }, { id: "b" }] })).toBe("ID\na\nb\n");
    });
  });

  describe("other arrays", () => {
    it("renders an empty array as nothing", () => {
      expect(formatHuman([])).toBe("");
    });

    it("renders an object wrapping an empty array as nothing", () => {
      expect(formatHuman({ endpoints: [] })).toBe("");
    });

    it("renders scalars one per line", () => {
      expect(formatHuman(["a", 2, true, null])).toBe("a\n2\ntrue\n\n");
    });

    it("renders a mixed array one JSON or scalar cell per line", () => {
      expect(formatHuman([1, { a: 1 }, [2]])).toBe('1\n{"a":1}\n[2]\n');
    });
  });

  describe("objects", () => {
    it("renders key<TAB>value lines with nested keys flattened", () => {
      expect(formatHuman({ id: "e1", usage: { cu: 5, window: { days: 7 } } })).toBe(
        "id\te1\nusage.cu\t5\nusage.window.days\t7\n",
      );
    });

    it("renders arrays inside an object as JSON", () => {
      expect(formatHuman({ chains: ["eth", "sol"], count: 2 })).toBe(
        'chains\t["eth","sol"]\ncount\t2\n',
      );
    });

    it("renders a lone non-table array value as a JSON line", () => {
      expect(formatHuman({ tags: ["a", "b"] })).toBe('tags\t["a","b"]\n');
    });

    it("renders null and empty-object values", () => {
      expect(formatHuman({ a: null, b: {} })).toBe("a\t\nb\t{}\n");
    });

    it("escapes control characters in single-line values", () => {
      expect(formatHuman({ note: "a\tb\rc" })).toBe("note\ta\\tb\\rc\n");
    });

    it("prints a lone multiline string as raw text", () => {
      expect(formatHuman({ answer: "line one\nline two" })).toBe("line one\nline two\n");
      expect(formatHuman({ answer: "line one\nline two\n" })).toBe("line one\nline two\n");
    });

    it("prints multiline strings as blocks after the scalar lines", () => {
      expect(formatHuman({ answer: "first\nsecond\n\n", id: "m1", n: 2 })).toBe(
        "id\tm1\nn\t2\n\nanswer:\nfirst\nsecond\n",
      );
    });

    it("separates several multiline blocks with blank lines", () => {
      expect(formatHuman({ a: "a1\na2", b: "b1\nb2" })).toBe("a:\na1\na2\n\nb:\nb1\nb2\n");
    });

    it("renders an empty object as nothing", () => {
      expect(formatHuman({})).toBe("");
    });
  });

  describe("scalars", () => {
    it.each([
      ["text", "text\n"],
      [42, "42\n"],
      [false, "false\n"],
      [null, "\n"],
      [undefined, "\n"],
      ["a\tb", "a\\tb\n"],
    ])("renders %j as %j", (value, expected) => {
      expect(formatHuman(value)).toBe(expected);
    });
  });
});

describe("formatText", () => {
  it.each([
    ["hello", "hello\n"],
    ["hello\n", "hello\n"],
    ["", "\n"],
  ])("renders %j as %j", (text, expected) => {
    expect(formatText(text)).toBe(expected);
  });
});

describe("formatHuman for a record with a record array and scalars", () => {
  it("prints scalars as key/value lines with the record array as one JSON cell", () => {
    expect(
      formatHuman({
        compute_units: 1000,
        from: "2026-10-01T00:00:00Z",
        series: [{ time: "2026-10-01T00:00:00Z", compute_units: 1 }],
        to: "2026-11-01T00:00:00Z",
      }),
    ).toBe(
      'compute_units\t1000\nfrom\t2026-10-01T00:00:00Z\nseries\t[{"time":"2026-10-01T00:00:00Z","compute_units":1}]\nto\t2026-11-01T00:00:00Z\n',
    );
  });
});

describe("formatJson", () => {
  it("renders compact JSON on one line", () => {
    expect(formatJson({ a: [1, 2], b: { c: null } }, false)).toBe('{"a":[1,2],"b":{"c":null}}\n');
  });

  it("renders pretty JSON with two-space indentation", () => {
    expect(formatJson({ a: [1], b: "x" }, true)).toBe('{\n  "a": [\n    1\n  ],\n  "b": "x"\n}\n');
  });

  it("renders undefined as null", () => {
    expect(formatJson(undefined, false)).toBe("null\n");
  });
});
