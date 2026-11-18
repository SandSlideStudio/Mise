import { useState, type InputHTMLAttributes } from 'react';
import { useT } from '../i18n/index.js';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Set both to let two fields share one eye (sign-up asks for the password twice). */
  shown?: boolean;
  onShownChange?: (shown: boolean) => void;
};

/**
 * A password field with an eye to see what was typed. The button is always
 * 44 px wide and as tall as the field, so a finger finds it.
 */
export function PasswordInput({ shown, onShownChange, className = '', ...rest }: Props) {
  const { t } = useT();
  const [own, setOwn] = useState(false);
  const visible = shown ?? own;
  const toggle = () => (onShownChange ? onShownChange(!visible) : setOwn(!visible));
  return (
    <div className="relative">
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={`field pr-12 ${className}`}
      />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={visible}
        aria-label={visible ? t('password.hide') : t('password.show')}
        className="text-ink-soft hover:text-ink absolute inset-y-0 right-0 flex w-11 items-center justify-center transition-colors"
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible ? <path d="M4 4l16 16" /> : null}
        </svg>
      </button>
    </div>
  );
}
