import { expect, describe, it } from "vitest";
import { parseToolName, toKebabCase } from "./tool-name.ts";

describe("toKebabCase", () => {
  it.each([
    ["get_endpoint", "get-endpoint"],
    ["answerQuestion", "answer-question"],
    ["AnswerQuestion", "answer-question"],
    ["getHTTPResponse", "get-http-response"],
    ["listChainsV2", "list-chains-v2"],
    ["already-kebab", "already-kebab"],
    ["__get__endpoint__", "get-endpoint"],
    ["mixed_camelCase-and spaces", "mixed-camel-case-and-spaces"],
    ["", ""],
  ])("converts %j to %j", (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });
});

describe("parseToolName", () => {
  it.each([
    ["nodeapi.get_endpoint", { namespace: "nodeapi", command: "get-endpoint" }],
    ["mavrik.answerQuestion", { namespace: "mavrik", command: "answer-question" }],
    ["a.b.c", { namespace: "a", command: "b-c" }],
  ])("parses %j", (input, expected) => {
    expect(parseToolName(input)).toStrictEqual(expected);
  });

  it.each(["get_endpoint", ".get_endpoint", "nodeapi.", "nodeapi.__", "__.get"])(
    "returns undefined for %j",
    (input) => {
      expect(parseToolName(input)).toBeUndefined();
    },
  );
});
