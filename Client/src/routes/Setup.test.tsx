// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PasswordState } from './Setup.js';

/**
 * Found walking through setup: a password too short was said twice, once
 * under the box and once in the step's list of what to fix.
 */

afterEach(cleanup);

describe('how the password stands in setup', () => {
  it('says it is too short while it is typed', () => {
    render(<PasswordState password="kort" confirm="" listed={false} />);
    expect(screen.getAllByText('That’s still under 12 characters.')).toHaveLength(1);
  });

  it('leaves what is wrong to the step’s list once Next has been tried', () => {
    render(<PasswordState password="kort" confirm="korte" listed />);
    expect(screen.queryByText(/12 characters/)).toBeNull();
    cleanup();
    render(<PasswordState password="long-enough-pass" confirm="long-enough-pas" listed />);
    expect(document.body.textContent).toBe('');
  });

  it('still says when the two match', () => {
    render(<PasswordState password="long-enough-pass" confirm="long-enough-pass" listed />);
    expect(screen.getByText(/✓/)).toBeTruthy();
  });
});
