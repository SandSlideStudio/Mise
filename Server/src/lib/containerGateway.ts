import { existsSync, readFileSync } from 'node:fs';

/**
 * The address a container's own network relays connections from.
 *
 * Docker publishes a port in two ways. Mostly the visitor's own address comes
 * through. But where Docker relays the connection itself (rootless Docker,
 * Podman, Docker Desktop, or IPv6 when the container's network has none),
 * every visitor arrives from the container's gateway, a private address,
 * wherever they really are. Mise can't tell those visitors apart, so it says
 * so in Settings → Connection.
 */

/** "0101A8C0" → "192.168.1.1": /proc/net/route writes IPv4 little-endian in hex. */
function ipv4FromHex(hex: string): string | null {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return null;
  const bytes = [6, 4, 2, 0].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return bytes.join('.');
}

/** "fe800000000000000000000000000001" → "fe80::1", written the way a socket reports it. */
function ipv6FromHex(hex: string): string | null {
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const long = (hex.match(/.{4}/g) ?? []).join(':');
  return new URL(`http://[${long}]`).hostname.slice(1, -1);
}

/** The default routes' gateways, from the kernel's route tables. Exported for tests. */
export function gatewaysFrom(route: string, ipv6Route: string): string[] {
  const found: string[] = [];
  for (const line of route.split('\n').slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination === '00000000' && gateway && gateway !== '00000000') {
      const address = ipv4FromHex(gateway);
      if (address) found.push(address);
    }
  }
  for (const line of ipv6Route.split('\n')) {
    const fields = line.trim().split(/\s+/);
    // destination, prefix length, source, source prefix, next hop, ...
    if (fields[0] === '0'.repeat(32) && fields[1] === '00' && fields[4] !== '0'.repeat(32)) {
      const address = fields[4] ? ipv6FromHex(fields[4]) : null;
      if (address) found.push(address);
    }
  }
  return found;
}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** Gateways to watch for: only inside a container, where they are its relay. */
export function containerGateways(): Set<string> {
  const inContainer = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
  if (!inContainer) return new Set();
  return new Set(gatewaysFrom(read('/proc/net/route'), read('/proc/net/ipv6_route')));
}
