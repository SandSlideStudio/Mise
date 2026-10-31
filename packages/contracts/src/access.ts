import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Outside access: a device beyond the kitchen's network asks, a chef or an
 * administrator approves it, and only then does Mise answer it.
 */

export const accessRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type AccessRequest = z.infer<typeof accessRequestSchema>;

/**
 * Where this device stands. "inside" means it is on the kitchen's network or
 * VPN and needs no approval; "none" means it hasn't asked, or its approval
 * ran out or was taken back.
 */
export const accessStatusSchema = z.object({
  status: z.enum(['inside', 'none', 'pending', 'approved']),
  name: z.string().nullable(),
  code: z.string().nullable(),
});
export type AccessStatus = z.infer<typeof accessStatusSchema>;

export const remoteDeviceSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: z.enum(['pending', 'approved']),
  /** Only while waiting: what the person asking should read out. */
  code: z.string().nullable(),
  requestedAt: z.string(),
  approvedAt: z.string().nullable(),
  approvedBy: z.string().nullable(),
  /** The approving device, when approved from outside. Null from the kitchen. */
  approvedFrom: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  /** "Safari on iPhone", read from the browser's own description. */
  browser: z.string(),
  address: z.string().nullable(),
  /** The device this list is being looked at on. */
  thisDevice: z.boolean(),
});
export type RemoteDevice = z.infer<typeof remoteDeviceSchema>;

export const remoteDevicesSchema = z.object({
  /** Whether the person looking is inside the kitchen. Outside, approving asks for a password. */
  inside: z.boolean(),
  devices: z.array(remoteDeviceSchema),
});
export type RemoteDevices = z.infer<typeof remoteDevicesSchema>;

export const approveRemoteDeviceSchema = z.object({
  /** Needed when approving from outside the kitchen. */
  password: z.string().max(200).optional(),
});
export type ApproveRemoteDevice = z.infer<typeof approveRemoteDeviceSchema>;
