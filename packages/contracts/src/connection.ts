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
  /**
   * The last visitor relayed by the container's own gateway. Mise can't tell
   * where such visitors really are, and counts them as inside.
   */
  containerGateway: z.object({ address: z.string(), at: z.string() }).nullable(),
  /** Whether those relayed visitors count as inside anyway, as an administrator chose. */
  trustContainerGateway: z.boolean(),
  https: z.object({
    /** The port HTTPS answers on inside Mise. The install may publish it as another. */
    port: z.number(),
    /** The port plain HTTP answers on, which Let's Encrypt's check reaches through port 80. */
    httpPort: z.number(),
    kitchen: z.object({
      enabled: z.boolean(),
      names: z.array(z.string()),
      expiresAt: z.string().nullable(),
      /** What a tablet shows for the authority it trusts, to compare. */
      fingerprint: z.string().nullable(),
    }),
    domain: z.object({
      enabled: z.boolean(),
      /** The name the current certificate is for. */
      domain: z.string().nullable(),
      expiresAt: z.string().nullable(),
      /** Why the last try failed, in Let's Encrypt's words. */
      error: z.string().nullable(),
    }),
  }),
  /** The address this page was opened through, to suggest and to warn. */
  currentHost: z.string(),
  /** Whether the person looking is inside the kitchen. */
  inside: z.boolean(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const updateConnectionSchema = z.object({
  outsideDomain: domainSchema.nullable().optional(),
  trustedProxy: addressSchema.nullable().optional(),
  trustContainerGateway: z.boolean().optional(),
});
export type UpdateConnection = z.infer<typeof updateConnectionSchema>;

/** A name a tablet reaches Mise by: an IP address or host name, no port. */
export const kitchenNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(/^[a-z0-9.:-]+$/, 'Use an address such as 192.168.1.50 or mise.local');

export const kitchenHttpsSchema = z.object({
  names: z.array(kitchenNameSchema).min(1).max(10),
});
export type KitchenHttps = z.infer<typeof kitchenHttpsSchema>;

/** What the trust page shows before anyone signs in. */
export const trustInfoSchema = z.object({
  enabled: z.boolean(),
  port: z.number(),
  names: z.array(z.string()),
  fingerprint: z.string().nullable(),
});
export type TrustInfo = z.infer<typeof trustInfoSchema>;
