import { describe, expect, it } from 'vitest';
import { sameRelease } from './version.js';

describe('loading ahead from a release build', () => {
  it('is only for an app of the same release', () => {
    expect(sameRelease('2.4.0', '2.4.0', true)).toBe(true);
    // A tablet left open on the release before, after the server updated.
    expect(sameRelease('2.3.1', '2.4.0', true)).toBe(false);
    // An app from before it said which release it is.
    expect(sameRelease(undefined, '2.4.0', true)).toBe(false);
  });

  it('is not checked in development, where the server has no release number', () => {
    expect(sameRelease('2.4.0', 'dev', false)).toBe(true);
    expect(sameRelease(undefined, 'dev', false)).toBe(true);
  });
});
