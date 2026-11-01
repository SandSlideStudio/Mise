import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * Whether a request came straight from the kitchen's own network.
 *
 * First-run setup trusts that without a code: someone on the wifi finishing
 * setup first is a small risk, and asking every home install for a code from
 * a log was a real nuisance. Anything that came through a proxy or tunnel, or
 * from a public address such as a router port forward, doesn't count. A
 * Cloudflare Tunnel running inside the network connects from a local address,
 * which is why forwarding headers rule a request out on their own.
 */

/** Headers a proxy, tunnel or CDN adds. Any of them means "not straight from the network". */
const FORWARDING_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'fly-client-ip',
];

function privateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number) as [number, number];
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    // 100.64.0.0/10: Tailscale and other overlay networks.
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function isPrivateAddress(address: string): boolean {
  const plain = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(plain) === 4) return privateIPv4(plain);
  if (isIP(plain) !== 6) return false;
  return (
    plain === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(plain) || // fc00::/7, unique local
    /^fe[89ab][0-9a-f]:/.test(plain) // fe80::/10, link local
  );
}

export function fromOwnNetwork(request: FastifyRequest): boolean {
  if (FORWARDING_HEADERS.some((name) => request.headers[name] !== undefined)) return false;
  // The socket's own peer, never a header: nothing here is taken on trust.
  return isPrivateAddress(request.socket.remoteAddress ?? '');
}

/** Headers that name the original client. Each must agree it is local. */
const CLIENT_HEADERS = ['cf-connecting-ip', 'true-client-ip', 'fly-client-ip', 'x-real-ip'];

/**
 * Whether a request counts as inside the kitchen for outside access: the
 * kitchen's own network or VPN, with no approval needed.
 *
 * Straight from a private address, yes. Through a proxy or tunnel, only when
 * that proxy is one Mise was told to trust (trusts), it sits on a private
 * address itself, and every address it passes on is private too. So a
 * Cloudflare Tunnel's visitors are outside, a VPN's members are inside, and a
 * header made up by someone on the internet changes nothing: they never reach
 * the socket from a private address.
 */
export function insideKitchen(
  request: FastifyRequest,
  trusts: (proxy: string) => boolean,
): boolean {
  const peer = request.socket.remoteAddress ?? '';
  if (!isPrivateAddress(peer)) return false;
  if (!FORWARDING_HEADERS.some((name) => request.headers[name] !== undefined)) return true;
  if (!trusts(plainAddress(peer))) return false;
  // Without X-Forwarded-For, request.ip is only the proxy itself.
  if (request.headers['x-forwarded-for'] === undefined) return false;
  if (!isPrivateAddress(request.ip)) return false;
  return CLIENT_HEADERS.every((name) => {
    const value = request.headers[name];
    return value === undefined || isPrivateAddress(String(value).trim());
  });
}

/** Whether a request came through a proxy or tunnel, by the headers one adds. */
export function forwarded(request: FastifyRequest): boolean {
  return FORWARDING_HEADERS.some((name) => request.headers[name] !== undefined);
}

/** An address as compared: "::ffff:192.168.1.60" and "192.168.1.60" are the same machine. */
export function plainAddress(address: string): string {
  return address
    .trim()
    .toLowerCase()
    .replace(/^::ffff:/, '');
}
