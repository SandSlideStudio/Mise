import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const BASE = {
  DATABASE_URL: 'postgres://mise:a-real-password@db:5432/mise',
  SESSION_SECRET: 'a'.repeat(64),
};

describe('configuration', () => {
  it('starts with real secrets', () => {
    expect(() => loadConfig({ ...BASE, NODE_ENV: 'production' })).not.toThrow();
  });

  it('refuses to run in production on the example secrets', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://mise:change-me-in-production@db:5432/mise',
        SESSION_SECRET: 'change-me-to-a-long-random-string-at-least-32-chars',
      }),
    ).toThrow(/SESSION_SECRET: still holds the example value[\s\S]*DATABASE_URL/);
  });

  it('lets development run on the example file', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://mise:change-me-in-production@localhost:5433/mise',
        SESSION_SECRET: 'change-me-to-a-long-random-string-at-least-32-chars',
      }),
    ).not.toThrow();
  });
});

describe('trusting a reverse proxy', () => {
  it('is off unless asked for', () => {
    expect(loadConfig(BASE).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...BASE, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(1);
    expect(loadConfig({ ...BASE, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(() => loadConfig({ ...BASE, TRUST_PROXY: 'sometimes' })).toThrow(/TRUST_PROXY/);
  });
});
