import { describe, expect, it } from 'vitest';
import { useTestContext } from '../test/harness.js';

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

describe('health', () => {
  it('says which version is running', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(response.json()).toMatchObject({ status: 'ok', version: expect.any(String) });
  });
});

describe('sign-in rate limit', () => {
  it("can't be dodged by sending a different X-Forwarded-For each time", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'not-a-real-password' },
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});
