import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

export type StubMode = "ok" | "unavailable" | "ghost-removed";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export function createStubMcpServer(mode: StubMode): McpServer {
  const server = new McpServer({ name: "stub", version: "1.0.0" });

  server.registerTool(
    "demo.list_items",
    {
      description: "List the demo items.",
      inputSchema: z.object({
        limit: z.number().int().optional().describe("Maximum number of items"),
      }),
      annotations: { readOnlyHint: true },
    },
    () => {
      const items = [
        { id: "a1", name: "Alpha", meta: { tier: "gold" }, tags: ["x", "y"] },
        { id: "b2", name: "Beta", meta: { tier: "silver" }, tags: [] },
      ];
      return { ...textResult({ items }), structuredContent: { items } };
    },
  );

  server.registerTool(
    "demo.get_item",
    {
      description: "Get one demo item.",
      inputSchema: z.object({ id: z.string().describe("Item id") }),
      annotations: { readOnlyHint: true },
    },
    ({ id }) => {
      if (id === "missing") {
        return {
          isError: true,
          ...textResult({ code: "not_found", message: "item not found" }),
        };
      }
      const item = { id, name: "Alpha", notes: "line one\nline two" };
      return { ...textResult(item), structuredContent: item };
    },
  );

  server.registerTool(
    "demo.delete_item",
    {
      description: "Delete one demo item.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: false },
    },
    ({ id }) => {
      const result = { deleted: id };
      return { ...textResult(result), structuredContent: result };
    },
  );

  // The "ghost-removed" mode drops it, like a tool removed on the server after the client cached the catalog.
  if (mode !== "ghost-removed") {
    server.registerTool(
      "demo.ghost",
      { description: "A tool the server may remove.", annotations: { readOnlyHint: true } },
      () => textResult({}),
    );
  }

  // Maps to the same command as demo.list_items, so it stays unmapped.
  server.registerTool(
    "demo.listItems",
    { description: "Collides with demo.list_items.", annotations: { readOnlyHint: true } },
    () => textResult({}),
  );

  // The auth namespace belongs to the built-in command.
  server.registerTool(
    "auth.status",
    {
      description: "Collides with the built-in auth command.",
      annotations: { readOnlyHint: true },
    },
    () => textResult({}),
  );

  return server;
}
