import { describe, expect, it } from 'vitest';
import { approvedOutside, useTestContext } from '../test/harness.js';

const ctx = useTestContext();

describe('security headers', () => {
  it('tell the browser what this page may do, on every response', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('leave HTTPS pinning off until the server is said to be behind HTTPS', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('come on errors too', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('changes from another page', () => {
  const login = (headers: Record<string, string>) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'not-a-password' },
      headers: { host: '192.168.1.5:3000', ...headers },
    });

  it('are refused, even from another app on the same machine', async () => {
    for (const origin of ['https://evil.example', 'http://192.168.1.5:8080']) {
      const response = await login({ origin });
      expect(response.statusCode, origin).toBe(403);
      expect(response.json().error.code).toBe('bad_origin');
    }
    expect((await login({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403);
  });

  it('are refused however the address is spelled', async () => {
    for (const url of ['/%61pi/auth/login', '/api//auth/login', '/api/auth/login?x=1']) {
      const response = await ctx.app.inject({
        method: 'POST',
        url,
        payload: { email: 'nobody@example.com', password: 'not-a-password' },
        headers: { host: '192.168.1.5:3000', origin: 'https://evil.example' },
      });
      // Refused, or not a route at all; never let through to sign in.
      expect(response.statusCode, url).not.toBe(401);
      if (response.statusCode !== 404) expect(response.json().error.code, url).toBe('bad_origin');
    }
  });

  it('go through from Mise’s own page, or from outside a browser', async () => {
    expect((await login({ origin: 'http://192.168.1.5:3000' })).statusCode).toBe(401);
    expect((await login({})).statusCode).toBe(401);
    // Behind a web server that passes the domain on as X-Forwarded-Host
    // (here an untrusted one, so the outside-access gate answers instead).
    const proxied = await login({
      origin: 'https://mise.example.com',
      'x-forwarded-host': 'mise.example.com',
    });
    expect(proxied.json().error.code).not.toBe('bad_origin');
  });
});

describe('health', () => {
  it('says which version is running', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.json()).toMatchObject({ status: 'ok', version: expect.any(String) });
  });
});

describe('sign-in rate limit', () => {
  it("can't be dodged by sending a different X-Forwarded-For each time", async () => {
    const phone = await approvedOutside(ctx.app);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'not-a-real-password' },
        headers: { 'x-forwarded-for': `203.0.113.${i}`, cookie: phone },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
