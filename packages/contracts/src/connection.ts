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

/** An IPv4 or IPv6 address, checked properly by the server. */
export const addressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(45)
  .regex(/^[0-9a-f:.]+$/, 'Use an address such as 192.168.1.60');

export const connectionSchema = z.object({
  outsideDomain: z.string().nullable(),
  /** The web server in front of Mise (Apache, say), whose word on the visitor is taken. */
  trustedProxy: z.string().nullable(),
  /** The last web server on the kitchen network seen passing requests on. */
  seenProxy: z.object({ address: z.string(), host: z.string(), at: z.string() }).nullable(),
  /** The address this page was opened through, to suggest and to warn. */
  currentHost: z.string(),
  /** Whether the person looking is inside the kitchen. */
  inside: z.boolean(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const updateConnectionSchema = z.object({
  outsideDomain: domainSchema.nullable().optional(),
  trustedProxy: addressSchema.nullable().optional(),
});
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;
