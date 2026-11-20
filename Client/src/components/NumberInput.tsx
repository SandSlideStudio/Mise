import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type Ref,
} from 'react';
import { useT } from '../i18n/index.js';
import { numberText, problemText, readNumber, type NumberRules } from '../lib/typedNumber.js';

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'min' | 'max' | 'step' | 'inputMode'
> & {
  value: string;
  onText: (text: string) => void;
  rules?: NumberRules;
  /** A price: written back with two decimals, 9,80 rather than 9,8. */
  money?: boolean;
  /**
   * Added to the classes of the sentence under the box saying what is wrong:
   * in a grid row, `order-last col-span-full` puts it under the whole row.
   */
  messageClassName?: string;
  ref?: Ref<HTMLInputElement>;
};

/**
 * A box for an amount, a price or a percentage. Text, not a browser number
 * box: that reads "9,80" by the browser's language, and an English browser
 * in a Dutch kitchen makes it 980 without a word. This reads a comma and a
 * point alike, says so when it can't read what was typed, and keeps the form
 * from saving until it can.
 */
export function NumberInput({
  value,
  onText,
  rules,
  money = false,
  messageClassName = '',
  ref,
  className = '',
  onBlur,
  onInvalid,
  'aria-describedby': describedBy,
  ...rest
}: Props) {
  const translator = useT();
  const own = useRef<HTMLInputElement | null>(null);
  const messageId = useId();
  // Once the cook has left the box, or tried to save.
  const [touched, setTouched] = useState(false);
  const read = readNumber(value, rules);
  const problem = read.problem ? problemText(translator, read.problem) : null;

  // The browser then refuses to submit the form, and points at this box.
  useLayoutEffect(() => {
    own.current?.setCustomValidity(problem ?? '');
  }, [problem]);

  // "Not a number" waits, since "-" or "," on the way to a number is not one
  // yet. Too much, or a half where a whole is asked, shows straight away.
  const showing = problem !== null && (touched || read.problem?.kind !== 'notNumber');
  const describing = [describedBy, showing ? messageId : null].filter(Boolean).join(' ');

  return (
    <>
      <input
        {...rest}
        ref={(element) => {
          own.current = element;
          if (typeof ref === 'function') ref(element);
          else if (ref) ref.current = element;
        }}
        type="text"
        inputMode={rules?.integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onText(e.target.value)}
        onBlur={(e) => {
          setTouched(true);
          // Written back the way this kitchen writes it, so "1.250" left in a
          // Dutch box reads "1,25" and shows how it was understood.
          if (read.value !== null) {
            const shown = numberText(read.value, translator.locale, { money });
            if (shown !== value) onText(shown);
          }
          onBlur?.(e);
        }}
        onInvalid={(e) => {
          setTouched(true);
          onInvalid?.(e);
        }}
        aria-invalid={showing || undefined}
        aria-describedby={describing || undefined}
        className={className}
      />
      {showing ? (
        <p
          id={messageId}
          role="alert"
          className={`text-danger mt-1.5 text-sm font-medium ${messageClassName}`}
        >
          {problem}
        </p>
      ) : null}
    </>
  );
}
