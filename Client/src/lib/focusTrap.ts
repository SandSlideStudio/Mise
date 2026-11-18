import { useEffect, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * For a dialog that covers the page: Tab and Shift+Tab go round what is in it,
 * since nothing behind can be used, and when it closes the focus goes back to
 * where it was, so a keyboard user is not dropped at the top of the page.
 */
export function useFocusTrap(container: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    function onKey(event: KeyboardEvent) {
      const box = container.current;
      if (event.key !== 'Tab' || !box) return;
      const focusable = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      const inside = box.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Only if the element is still there and nothing else took the focus.
      if (
        before?.isConnected &&
        (document.activeElement === document.body || !document.activeElement)
      ) {
        before.focus();
      }
    };
  }, [container]);
}
