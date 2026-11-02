import { describe, expect, it } from 'vitest';
import { gatewaysFrom } from './containerGateway.js';

describe('the container gateway', () => {
  it('is read from the default routes, IPv4 and IPv6, as a socket writes them', () => {
    const route = [
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
      'eth0\t00000000\t010011AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
      'eth0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
    ].join('\n');
    const ipv6 =
      '00000000000000000000000000000000 00 00000000000000000000000000000000 00 fe800000000000000000000000000001 00000400 00000001 00000000 00000003 eth0\n' +
      'fe800000000000000000000000000000 40 00000000000000000000000000000000 00 00000000000000000000000000000000 00000100 00000001 00000000 00000001 eth0';
    expect(gatewaysFrom(route, ipv6)).toEqual(['172.17.0.1', 'fe80::1']);
  });

  it('is nothing without a default route', () => {
    expect(gatewaysFrom('Iface\tDestination\tGateway\n', '')).toEqual([]);
  });
});
