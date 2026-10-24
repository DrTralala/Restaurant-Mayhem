import { useEffect, useRef } from 'react';

const TABBABLE_SELECTOR = [
  'button',
  'input',
  'select',
  'textarea',
  'a[href]',
  'summary',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

function isDisabled(element) {
  if (element.disabled === true) return true;
  return typeof element.matches === 'function' && element.matches(':disabled');
}

function isHiddenOrInert(element) {
  for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert')) return true;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  }
  return false;
}

function isFirstDirectSummary(element) {
  const details = element.parentElement;
  return element.tagName === 'SUMMARY'
    && details?.tagName === 'DETAILS'
    && details.querySelector(':scope > summary') === element;
}

function isTabCandidate(element) {
  if (element.tagName !== 'SUMMARY') return element.tabIndex >= 0;
  if (element.hasAttribute('tabindex')) return element.tabIndex >= 0;
  return isFirstDirectSummary(element);
}

function tabbableDescendants(dialog) {
  return Array.from(dialog.querySelectorAll(TABBABLE_SELECTOR)).filter(element =>
    isTabCandidate(element)
    && !isDisabled(element)
    && !isHiddenOrInert(element));
}

function canRestoreFocus(opener) {
  return opener instanceof HTMLElement
    && opener.isConnected
    && typeof opener.focus === 'function'
    && !isDisabled(opener)
    && !isHiddenOrInert(opener);
}

/**
 * Keyboard containment for an open dialog. The listener stays on the document
 * in the bubble phase so child handlers can consume keys before the dialog
 * sees them, and Tab is recalculated from the current DOM on every press.
 * This is keyboard containment only; it does not trap programmatic focus or
 * replace assistive-technology focus management.
 */
export default function useDialogKeyboardFocus({
  isOpen,
  dialogRef,
  initialFocusRef,
  onClose,
}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return undefined;
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const opener = document.activeElement instanceof HTMLElement
      && document.activeElement !== document.body
      ? document.activeElement
      : null;
    let escapeHandled = false;

    const initial = initialFocusRef?.current;
    const initialTarget = initial?.isConnected
      && !isDisabled(initial)
      && !isHiddenOrInert(initial)
      ? initial
      : dialog;
    initialTarget.focus?.();

    const handleKeyDown = event => {
      if (event.defaultPrevented || event.isComposing) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || escapeHandled) return;
        escapeHandled = true;
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const currentDialog = dialogRef.current;
      if (!currentDialog) return;

      event.preventDefault();
      const tabbables = tabbableDescendants(currentDialog);
      if (tabbables.length === 0) {
        currentDialog.focus();
        return;
      }

      const index = tabbables.indexOf(document.activeElement);
      let target;
      if (index === -1) {
        target = event.shiftKey ? tabbables[tabbables.length - 1] : tabbables[0];
      } else if (event.shiftKey) {
        target = tabbables[index === 0 ? tabbables.length - 1 : index - 1];
      } else {
        target = tabbables[index === tabbables.length - 1 ? 0 : index + 1];
      }
      target.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const active = document.activeElement;
      const focusStayedInside = dialog.contains(active);
      const focusIsBody = active == null || active === document.body;
      if (!focusStayedInside && !focusIsBody) return;
      if (canRestoreFocus(opener)) opener.focus();
    };
  }, [isOpen, dialogRef, initialFocusRef]);
}
