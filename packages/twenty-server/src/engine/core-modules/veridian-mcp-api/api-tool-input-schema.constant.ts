import { z } from 'zod';

import { API_LIMITS } from 'src/engine/core-modules/veridian-mcp-api/utils/check-api-operation.util';

export const apiToolInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(API_LIMITS.query)
    .describe('One GraphQL operation on records, for example a people query'),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Variables of the operation'),
});
