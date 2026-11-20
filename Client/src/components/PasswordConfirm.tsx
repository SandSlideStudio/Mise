import { PasswordInput } from './PasswordInput.js';
import { RequestFailed } from '../api/client.js';

/**
 * Your own password, typed again to prove it is still you: before approving
 * a device, adding someone or enrolling a tablet from outside the kitchen, or
 * changing your own password or email. Always the same field; the screen says
 * next to it why it is asked.
 */
export function PasswordConfirm({
  id,
  label,
  value,
  onChange,
  autoFocus,
  className = 'min-w-56 flex-1',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <PasswordInput
        id={id}
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        required
      />
    </div>
  );
}

/** The server turned it down for want of the right password, whether or not one was asked. */
export function refusedForPassword(error: unknown): boolean {
  return error instanceof RequestFailed && error.code === 'wrong_password';
}
