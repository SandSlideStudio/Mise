/**
 * The Mise mark: a knife and herbs standing in a stack of prep bowls.
 *
 * The artwork lives in `Client/public/logo.png` rather than being inlined
 * here, so it can be replaced without touching code. On a dark ground it is
 * lifted by a filter token rather than recoloured, and the wordmark shifts to
 * sage with the brand token.
 */
export function Logo({
  size = 32,
  showWordmark = true,
  wordmarkClassName = 'text-[26px]',
}: {
  size?: number;
  showWordmark?: boolean;
  wordmarkClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-3">
      <img
        src="/logo.png"
        alt={showWordmark ? '' : 'Mise'}
        width={size}
        height={size}
        className="logo-mark"
        style={{ width: size, height: size }}
      />
      {showWordmark ? (
        <span
          className={`font-display text-brand leading-none font-semibold tracking-[0.02em] ${wordmarkClassName}`}
        >
          Mise
        </span>
      ) : null}
    </span>
  );
}
