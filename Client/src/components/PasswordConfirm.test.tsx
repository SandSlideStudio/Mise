// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RequestFailed } from '../api/client.js';
import { AskedAction } from './PasswordConfirm.js';

/** A one-tap action that, from outside the kitchen, asks for your password first. */

afterEach(cleanup);

function tap(outside: boolean | undefined, error: unknown = null) {
  const onAct = vi.fn();
  render(
    <AskedAction
      id="lift"
      outside={outside}
      error={error}
      pending={false}
      label="Lift the lock"
      onAct={onAct}
    />,
  );
  return onAct;
}

it('does it straight away inside the kitchen', () => {
  const onAct = tap(false);
  fireEvent.click(screen.getByRole('button', { name: 'Lift the lock' }));
  expect(onAct).toHaveBeenCalledWith(undefined);
});

it('from outside, asks for the password and goes on with it', () => {
  const onAct = tap(true);
  fireEvent.click(screen.getByRole('button', { name: 'Lift the lock' }));
  expect(onAct).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Lift the lock' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'mine' } });
  fireEvent.click(button);
  expect(onAct).toHaveBeenCalledWith('mine');
});

it('asks when the server turned the last try down for want of the password', () => {
  const refused = new RequestFailed(
    403,
    { error: { code: 'wrong_password', message: 'That password is not right.' } },
    'Forbidden',
  );
  tap(undefined, refused);
  expect(screen.getByLabelText('Your password')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Your password')).toBeNull();
});
