import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { PasswordInput } from './PasswordInput.js';
import { RequestFailed } from '../api/client.js';
import { useT } from '../i18n/index.js';

/**
 * Your own password, typed again to prove it is still you: before approving
 * a device, adding or removing someone, lifting a lock, enrolling a tablet,
 * or changing where backups go or who counts as inside from outside the
 * kitchen, or changing your own password or email. Always the same field;
 * the screen says next to it why it is asked.
 */
export function PasswordConfirm({
  id,
  label,
  value,
  onChange,
  autoFocus,
  describedBy,
  className = 'min-w-56 flex-1',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** The id of what says why it is asked. */
  describedBy?: string;
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
        aria-describedby={describedBy}
        required
      />
    </div>
  );
}

/** The server turned it down for want of the right password, whether or not one was asked. */
export function refusedForPassword(error: unknown): boolean {
  return (
    error instanceof RequestFailed &&
    (error.code === 'wrong_password' || error.code === 'password_missing')
  );
}

/** The field inside a form that asks for it from outside the kitchen, and why. */
export function OutsidePassword({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useT();
  return (
    <div>
      <PasswordConfirm
        id={id}
        className="max-w-sm"
        label={t('confirm.passwordLabel')}
        value={value}
        onChange={onChange}
        describedBy={`${id}-why`}
      />
      <p id={`${id}-why`} className="text-ink-faint mt-1.5 text-sm">
        {t('confirm.whyOutside')}
      </p>
    </div>
  );
}

/**
 * Your password and the button that goes on with it: what a tap turns into
 * from outside the kitchen, for an action that would otherwise need nothing
 * more. Says why it is asked.
 */
export function PasswordPrompt({
  id,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
  danger,
}: {
  id: string;
  submitLabel: ReactNode;
  pending: boolean;
  onSubmit: (currentPassword: string) => void;
  onCancel: () => void;
  /** The button is the one that removes or takes away. */
  danger?: boolean;
}) {
  const { t } = useT();
  const [password, setPassword] = useState('');

  function submit() {
    if (!password || pending) return;
    onSubmit(password);
    setPassword('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    } else if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      // Only this: never the form it may sit in.
      event.preventDefault();
      event.stopPropagation();
      submit();
    }
  }

  // Not a <form>: it often opens inside one (where backups go, the kitchen's
  // certificate), and a form inside a form submits the outer one instead.
  return (
    <div role="group" onKeyDown={onKeyDown} className="flex basis-full flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <PasswordConfirm
          id={id}
          label={t('confirm.passwordLabel')}
          value={password}
          onChange={setPassword}
          describedBy={`${id}-why`}
          autoFocus
        />
        <button
          type="button"
          className={danger ? 'btn-small border-danger text-danger' : 'btn-small'}
          disabled={pending || !password}
          onClick={submit}
        >
          {submitLabel}
        </button>
        <button type="button" className="btn-small" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      <p id={`${id}-why`} className="text-ink-faint text-sm">
        {t('confirm.whyOutside')}
      </p>
    </div>
  );
}

/**
 * A button that does its thing straight away inside the kitchen, and from
 * outside first asks for your password (see PasswordPrompt). It also asks
 * when the server turned the last try down for want of it, so a screen that
 * didn't know yet where it was learns from the answer.
 */
export function AskedAction({
  id,
  outside,
  error,
  pending,
  label,
  className = 'btn-small',
  danger,
  disabled,
  title,
  onAct,
}: {
  id: string;
  outside: boolean | undefined;
  /** The last try's error, if any. */
  error: unknown;
  pending: boolean;
  label: ReactNode;
  className?: string;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  onAct: (currentPassword: string | undefined) => void;
}) {
  const [asking, setAsking] = useState(false);
  // Cancelled after a refusal: the refusal alone doesn't open it again.
  const [dismissed, setDismissed] = useState<unknown>(null);
  const refused = refusedForPassword(error) && error !== dismissed;
  // Called off: focus goes back to the button it opened from, not the page.
  const refocus = useRef(false);
  const button = useCallback((element: HTMLButtonElement | null) => {
    if (element && refocus.current) {
      refocus.current = false;
      element.focus();
    }
  }, []);

  if (asking || refused) {
    return (
      <PasswordPrompt
        id={id}
        submitLabel={label}
        pending={pending}
        danger={danger}
        onSubmit={(password) => {
          setAsking(false);
          setDismissed(null);
          onAct(password);
        }}
        onCancel={() => {
          refocus.current = true;
          setAsking(false);
          setDismissed(error);
        }}
      />
    );
  }

  return (
    <button
      ref={button}
      type="button"
      className={className}
      disabled={pending || disabled}
      title={title}
      onClick={() => (outside === true ? setAsking(true) : onAct(undefined))}
    >
      {label}
    </button>
  );
}
