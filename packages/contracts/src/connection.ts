import { z } from 'zod';

/**
 * How this server is reached. For now, the one address that leads to Mise
 * from outside the kitchen; HTTPS settings join it here.
 */

/** A bare host name: mise.example.com. No scheme, port or path. */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/,
    'Use a domain name such as mise.example.com',
  );

export const connectionSchema = z.object({
  outsideDomain: z.string().nullable(),
  /** The address this page was opened through, to suggest and to warn. */
  currentHost: z.string(),
  /** Whether the person looking is inside the kitchen. */
  inside: z.boolean(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const updateConnectionSchema = z.object({
  outsideDomain: domainSchema.nullable(),
});
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;
