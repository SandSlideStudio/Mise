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

it('inside a form, Enter goes on with the password and never sends the form around it', () => {
  const onAct = vi.fn();
  const onOuterSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  render(
    <form onSubmit={onOuterSubmit}>
      <AskedAction
        id="test"
        outside
        error={null}
        pending={false}
        label="Test the connection"
        onAct={onAct}
      />
    </form>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Test the connection' }));
  // No form of its own inside the other one.
  expect(document.querySelectorAll('form')).toHaveLength(1);
  const field = screen.getByLabelText('Your password');
  fireEvent.change(field, { target: { value: 'mine' } });
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(onAct).toHaveBeenCalledWith('mine');
  expect(onOuterSubmit).not.toHaveBeenCalled();
});

it('Escape calls it off and puts focus back on the button', () => {
  const onAct = tap(true);
  fireEvent.click(screen.getByRole('button', { name: 'Lift the lock' }));
  const field = screen.getByLabelText('Your password');
  expect(document.activeElement).toBe(field);
  expect(field.getAttribute('aria-describedby')).toBe('lift-why');
  fireEvent.keyDown(field, { key: 'Escape' });
  expect(screen.queryByLabelText('Your password')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Lift the lock' }));
  expect(onAct).not.toHaveBeenCalled();
});
