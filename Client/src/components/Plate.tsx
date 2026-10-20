import type { ElementType, ReactNode } from 'react';

/**
 * The plate: square, hairline, with registration marks at the corners so it
 * reads as drawn rather than styled. Everything in Mise that holds other things
 * sits on one.
 */
export function Plate({
  as: Tag = 'div',
  className = '',
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={`plate ${className}`}>
      <i className="corner tl" aria-hidden />
      <i className="corner tr" aria-hidden />
      <i className="corner bl" aria-hidden />
      <i className="corner br" aria-hidden />
      {children}
    </Tag>
  );
}

/** The head of a plate: a named run and, optionally, what it adds up to. */
export function PlateHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="border-rule flex flex-wrap items-center gap-3 border-b px-[18px] py-3">
      <h2 className="font-display text-brand text-[22px] font-semibold tracking-[0.14em] uppercase">
        {title}
      </h2>
      {aside ? <span className="text-ink-soft ml-auto text-[15px]">{aside}</span> : null}
    </div>
  );
}
