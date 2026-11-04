import { describe, expect, it } from 'vitest';
import { RequestFailed } from '../api/client.js';
import { createTranslator, errorMessage } from './index.js';

const failed = (status: number, code: string, message: string, details?: unknown) =>
  new RequestFailed(status, { error: { code, message, details } }, '');

describe('what Mise refused, in the kitchen’s language', () => {
  const nl = createTranslator('nl');

  it('translates a refusal, with the names it mentions', () => {
    expect(
      errorMessage(
        nl,
        failed(409, 'still_used', 'Still used by Tart.', { names: ['Tart', 'Pie'] }),
      ),
    ).toBe('Wordt nog gebruikt door Tart, Pie. Haal het daar eerst uit.');
    expect(
      errorMessage(nl, failed(409, 'email_taken', 'Someone already has that email address.')),
    ).toBe('Iemand heeft dat e-mailadres al.');
  });

  it('keeps the server’s words when a name it needs is missing', () => {
    expect(errorMessage(nl, failed(400, 'recipe_loop', 'A cannot contain B.'))).toBe(
      'A cannot contain B.',
    );
  });

  it('says "too many tries" for any rate limit', () => {
    expect(errorMessage(nl, failed(429, 'FST_ERR_RATE_LIMIT', 'Rate limit exceeded'))).toBe(
      nl.t('error.tooManyRequests'),
    );
  });
});
