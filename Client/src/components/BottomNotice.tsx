import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

const HOST_ID = 'mise-bottom-notices';

/**
 * One place at the bottom of the screen for the notices that sit over the
 * page (a tick not sent yet, changes going out, an idle sign-out coming), so
 * two at once stack instead of covering each other.
 */
function host(): HTMLElement {
  let element = document.getElementById(HOST_ID);
  if (!element) {
    element = document.createElement('div');
    element.id = HOST_ID;
    element.className =
      'no-print pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-4 pb-4';
    document.body.appendChild(element);
  }
  return element;
}

/** A notice over the page, at the bottom, never pushing the page down. */
export function BottomNotice({ children }: { children: ReactNode }) {
  return createPortal(
    <div className="pointer-events-auto flex max-w-full justify-center">{children}</div>,
    host(),
  );
}
