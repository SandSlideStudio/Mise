import { useCallback, useRef } from 'react';

/**
 * Marks a row that scrolls sideways with which ends still have more to show
 * (`data-more="start end"`), so it can fade there. Without it, a cut-off last
 * tab looks like the end of the row. Use the returned callback as the row's `ref`.
 */
export function useScrollFade<T extends HTMLElement>() {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const update = () => {
      const more: string[] = [];
      if (el.scrollLeft > 2) more.push('start');
      if (el.scrollLeft + el.clientWidth < el.scrollWidth - 2) more.push('end');
      el.dataset.more = more.join(' ');
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    cleanup.current = () => {
      el.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
}
