import * as z from "zod";

export const ToolDefinition = z.object({
  name: z.string(),
  description: z.string().nullish(),
  inputSchema: z.looseObject({
    properties: z.record(z.string(), z.unknown()).nullish(),
    required: z.array(z.string()).nullish(),
    additionalProperties: z.unknown().optional(),
  }),
  annotations: z
    .looseObject({
      readOnlyHint: z.boolean().nullish(),
      destructiveHint: z.boolean().nullish(),
    })
    .nullish(),
});

export type ToolDefinition = z.infer<typeof ToolDefinition>;
