import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Button } from './Button';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

export type DialogProps = {
  open: boolean;
  /** Called for Escape, the close button and a click on the backdrop; the owner sets `open` to false. */
  onClose: () => void;
  title: string;
  /** The accessible name of the close button, in the page's language. */
  closeLabel: string;
  /**
   * Where focus goes when the dialog closes. Defaults to whatever had focus when it opened,
   * which is wrong in Safari, where clicking a button does not focus it: pass the opener.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
  children: ReactNode;
};

/**
 * A modal dialog (`role="dialog"`, `aria-modal`). While it is open, focus stays inside it: Tab
 * and Shift+Tab wrap, and focus that escapes by any other means is pulled back. Escape closes
 * it, and focus returns to the opener.
 */
export function Dialog({ open, onClose, title, closeLabel, returnFocusTo, children }: DialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panelElement = panel.current;
    if (panelElement === null) return undefined;

    // Start on the first control inside; the panel itself when it has none.
    (focusableIn(panelElement)[0] ?? panelElement).focus();
    const scrollLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus that leaves by any route other than Tab (a screen reader, a script) comes back.
    const pullBack = (event: FocusEvent) => {
      if (event.target instanceof Node && !panelElement.contains(event.target)) {
        (focusableIn(panelElement)[0] ?? panelElement).focus();
      }
    };
    document.addEventListener('focusin', pullBack);

    return () => {
      document.removeEventListener('focusin', pullBack);
      document.body.style.overflow = scrollLock;
      const target = returnFocusTo?.current ?? opener;
      if (target?.isConnected === true) target.focus();
    };
  }, [open, returnFocusTo]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const panelElement = panel.current;
    if (panelElement === null) return;
    const controls = focusableIn(panelElement);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (first === undefined || last === undefined) {
      event.preventDefault();
      panelElement.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panelElement)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else {
      // Safari does not Tab to links, so the last control it knows may not be `last` and its Tab
      // can leave the page for the document. Once the browser has moved focus, bring it back.
      const forward = !event.shiftKey;
      window.setTimeout(() => {
        if (!panelElement.contains(document.activeElement)) (forward ? first : last).focus();
      }, 0);
    }
  };

  return (
    <div className="dose-dialog" onKeyDown={onKeyDown}>
      <div className="dose-dialog__backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="dose-dialog__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="dose-dialog__header">
          <h2 className="dose-dialog__title" id={titleId}>
            {title}
          </h2>
          <Button variant="quiet" onClick={onClose} aria-label={closeLabel}>
            <span aria-hidden="true">×</span>
          </Button>
        </div>
        <div className="dose-dialog__body">{children}</div>
      </div>
    </div>
  );
}
