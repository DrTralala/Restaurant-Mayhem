import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import useDialogKeyboardFocus from './useDialogKeyboardFocus';

function StateHarness({ onClose, controls = true, onDialogKeyDown }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const initialFocusRef = useRef(null);
  useDialogKeyboardFocus({
    isOpen: open,
    dialogRef,
    initialFocusRef,
    onClose: () => {
      onClose?.();
      setOpen(false);
    },
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <button type="button">Outside</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test dialog"
          tabIndex={-1} onKeyDown={onDialogKeyDown}>
          <button ref={initialFocusRef} type="button">Close</button>
          {controls && (
            <>
              <button type="button">Middle</button>
              <button type="button">Last</button>
            </>
          )}
        </div>
      )}
    </>
  );
}

function CallbackHarness({ onClose }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const initialFocusRef = useRef(null);
  useDialogKeyboardFocus({
    isOpen: open,
    dialogRef,
    initialFocusRef,
    onClose: () => {
      onClose();
      setOpen(false);
    },
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-label="Callback dialog" tabIndex={-1}>
          <button ref={initialFocusRef} type="button">Close</button>
          <button type="button">Middle</button>
        </div>
      )}
    </>
  );
}

function SuccessorHarness() {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const initialFocusRef = useRef(null);
  const successorRef = useRef(null);
  useDialogKeyboardFocus({
    isOpen: open,
    dialogRef,
    initialFocusRef,
    onClose: () => {
      successorRef.current?.focus();
      setOpen(false);
    },
  });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
      <button ref={successorRef} type="button">Successor</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-label="Successor dialog" tabIndex={-1}>
          <button ref={initialFocusRef} type="button">Close</button>
        </div>
      )}
    </>
  );
}

function DisconnectedOpenerHarness() {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const dialogRef = useRef(null);
  const initialFocusRef = useRef(null);
  useDialogKeyboardFocus({
    isOpen: open,
    dialogRef,
    initialFocusRef,
    onClose: () => setOpen(false),
  });

  return (
    <>
      {showOpener && <button type="button" onClick={() => setOpen(true)}>Open dialog</button>}
      <button type="button" onClick={() => setShowOpener(false)}>Detach opener</button>
      {open && (
        <div ref={dialogRef} role="dialog" aria-label="Detached dialog" tabIndex={-1}>
          <button ref={initialFocusRef} type="button">Close</button>
        </div>
      )}
    </>
  );
}

function StaticHarness({ onClose, children = null, withInitialFocus = true }) {
  const dialogRef = useRef(null);
  const initialFocusRef = useRef(null);
  useDialogKeyboardFocus({
    isOpen: true,
    dialogRef,
    initialFocusRef: withInitialFocus ? initialFocusRef : null,
    onClose,
  });

  return (
    <div ref={dialogRef} role="dialog" aria-label="Static dialog" tabIndex={-1}>
      {withInitialFocus && <button ref={initialFocusRef} type="button">Close</button>}
      {children}
    </div>
  );
}

const tab = (options = {}) => fireEvent.keyDown(document.activeElement, { key: 'Tab', ...options });
const escape = (options = {}) => fireEvent.keyDown(document.activeElement, { key: 'Escape', ...options });

describe('useDialogKeyboardFocus lifecycle', () => {
  it('focuses the initial control, restores the opener and refocuses on reopen', () => {
    render(<StateHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();

    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('uses the latest close callback without rebinding or re-running entry focus', () => {
    const first = vi.fn();
    const second = vi.fn();
    const addListener = vi.spyOn(document, 'addEventListener');
    const view = render(<CallbackHarness onClose={first} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    addListener.mockClear();

    const middle = screen.getByRole('button', { name: 'Middle' });
    middle.focus();
    view.rerender(<CallbackHarness onClose={second} />);

    expect(middle).toHaveFocus();
    expect(addListener.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);

    escape();

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    addListener.mockRestore();
  });

  it('restores the opener when focus was lost to the body', () => {
    render(<StateHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);

    document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(opener).toHaveFocus();
  });

  it('leaves deliberate outside focus alone and does not trap focusin', () => {
    render(<StateHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const outside = screen.getByRole('button', { name: 'Outside' });

    outside.focus();
    expect(outside).toHaveFocus();

    escape();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
  });

  it('skips a disconnected opener without throwing', () => {
    render(<DisconnectedOpenerHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    fireEvent.click(screen.getByRole('button', { name: 'Detach opener' }));
    screen.getByRole('button', { name: 'Close' }).focus();

    expect(() => escape()).not.toThrow();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
  });

  it('skips a disabled opener', () => {
    render(<StateHarness />);
    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    fireEvent.click(opener);

    opener.disabled = true;
    escape();

    expect(document.activeElement).toBe(document.body);
  });

  it('never steals focus back from a successor dialog focused during close', () => {
    render(<SuccessorHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    escape();

    expect(screen.getByRole('button', { name: 'Successor' })).toHaveFocus();
  });

  it('falls back to the dialog when no initial control is supplied', () => {
    render(<StaticHarness withInitialFocus={false} />);

    expect(screen.getByRole('dialog', { name: 'Static dialog' })).toHaveFocus();
  });
});

describe('useDialogKeyboardFocus Tab containment', () => {
  it('wraps both directions and moves from a middle control', () => {
    render(<StaticHarness>
      <button type="button">Middle</button>
      <button type="button">Last</button>
    </StaticHarness>);
    const close = screen.getByRole('button', { name: 'Close' });
    const middle = screen.getByRole('button', { name: 'Middle' });

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Last' }), { key: 'Tab' });
    expect(close).toHaveFocus();

    middle.focus();
    fireEvent.keyDown(middle, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
  });

  it('treats the dialog itself and outside focus as non-tabstops', () => {
    render(<StaticHarness>
      <button type="button">Middle</button>
      <button type="button">Last</button>
    </StaticHarness>);
    const dialog = screen.getByRole('dialog', { name: 'Static dialog' });
    const close = screen.getByRole('button', { name: 'Close' });
    const last = screen.getByRole('button', { name: 'Last' });

    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();

    dialog.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('queries dynamic, disabled, hidden and inert descendants at each keypress', () => {
    render(<StaticHarness>
      <button type="button">Middle</button>
      <button type="button">Last</button>
    </StaticHarness>);
    const close = screen.getByRole('button', { name: 'Close' });

    const extra = document.createElement('button');
    extra.type = 'button';
    extra.textContent = 'Added later';
    screen.getByRole('dialog').appendChild(extra);

    screen.getByRole('button', { name: 'Last' }).focus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(extra).toHaveFocus();

    fireEvent.keyDown(extra, { key: 'Tab' });
    expect(close).toHaveFocus();

    extra.remove();
    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(close).toHaveFocus();
  });

  it('excludes disabled, hidden, inert and negative-tabindex controls', () => {
    render(
      <StaticHarness withInitialFocus={false}>
        <button type="button" hidden>Hidden attribute</button>
        <div style={{ display: 'none' }}><button type="button">Display none</button></div>
        <div style={{ visibility: 'hidden' }}><button type="button">Visibility hidden</button></div>
        <div inert=""><button type="button">Inert ancestor</button></div>
        <button type="button">First visible</button>
        <button type="button" disabled>Disabled</button>
        <button type="button" tabIndex={-1}>Negative tabindex</button>
        <button type="button">Last visible</button>
      </StaticHarness>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Static dialog' });
    const first = screen.getByRole('button', { name: 'First visible' });
    const last = screen.getByRole('button', { name: 'Last visible' });

    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab' });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('keeps focus on the dialog when there are no tabbable controls', () => {
    render(<StaticHarness withInitialFocus={false} />);
    const dialog = screen.getByRole('dialog', { name: 'Static dialog' });

    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(dialog).toHaveFocus();
  });

  it('includes native disclosure summaries in both directions and boundary wrap', () => {
    render(
      <StaticHarness>
        <details open>
          <summary>First summary</summary>
          <button type="button">Inside details</button>
        </details>
        <button type="button">Last</button>
      </StaticHarness>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const summary = screen.getByText('First summary');
    const inside = screen.getByRole('button', { name: 'Inside details' });
    const last = screen.getByRole('button', { name: 'Last' });

    close.focus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(summary).toHaveFocus();

    fireEvent.keyDown(summary, { key: 'Tab' });
    expect(inside).toHaveFocus();

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    summary.focus();
    fireEvent.keyDown(summary, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
  });

  it('excludes secondary and outside summaries unless explicit tabindex makes them eligible', () => {
    render(
      <StaticHarness>
        <details open>
          <summary>Primary summary</summary>
          <summary>Secondary summary</summary>
          <button type="button">Inside details</button>
        </details>
        <summary>Outside summary</summary>
        <details open>
          <summary>Explicit primary</summary>
          <summary tabIndex={0}>Explicit secondary</summary>
        </details>
        <button type="button">Last</button>
      </StaticHarness>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const primary = screen.getByText('Primary summary');
    const inside = screen.getByRole('button', { name: 'Inside details' });
    const explicitPrimary = screen.getByText('Explicit primary');
    const explicitSecondary = screen.getByText('Explicit secondary');
    const last = screen.getByRole('button', { name: 'Last' });

    primary.focus();
    fireEvent.keyDown(primary, { key: 'Tab' });
    expect(inside).toHaveFocus();

    fireEvent.keyDown(inside, { key: 'Tab' });
    expect(explicitPrimary).toHaveFocus();

    fireEvent.keyDown(explicitPrimary, { key: 'Tab' });
    expect(explicitSecondary).toHaveFocus();

    fireEvent.keyDown(explicitSecondary, { key: 'Tab' });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    explicitSecondary.focus();
    fireEvent.keyDown(explicitSecondary, { key: 'Tab', shiftKey: true });
    expect(explicitPrimary).toHaveFocus();
  });

  it('honours explicit negative tabindex and hidden or inert summaries', () => {
    render(
      <StaticHarness withInitialFocus={false}>
        <details open>
          <summary tabIndex={-1}>Removed summary</summary>
          <button type="button">Inside removed</button>
        </details>
        <details open>
          <summary hidden>Hidden summary</summary>
          <button type="button">Inside hidden</button>
        </details>
        <div style={{ display: 'none' }}>
          <details open><summary>Display none summary</summary></details>
        </div>
        <div inert="">
          <details open><summary>Inert summary</summary></details>
        </div>
        <details open>
          <summary>First visible summary</summary>
        </details>
        <button type="button">Last visible</button>
      </StaticHarness>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Static dialog' });
    const insideRemoved = screen.getByRole('button', { name: 'Inside removed' });
    const insideHidden = screen.getByRole('button', { name: 'Inside hidden' });
    const firstVisible = screen.getByText('First visible summary');
    const last = screen.getByRole('button', { name: 'Last visible' });

    expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(insideRemoved).toHaveFocus();

    fireEvent.keyDown(insideRemoved, { key: 'Tab' });
    expect(insideHidden).toHaveFocus();

    fireEvent.keyDown(insideHidden, { key: 'Tab' });
    expect(firstVisible).toHaveFocus();

    fireEvent.keyDown(firstVisible, { key: 'Tab' });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Tab', shiftKey: true });
    expect(firstVisible).toHaveFocus();
  });

  it('includes a native first summary when its tabIndex reports negative', () => {
    render(
      <StaticHarness withInitialFocus={false}>
        <details open>
          <summary>Fallback summary</summary>
        </details>
      </StaticHarness>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Static dialog' });
    const summary = screen.getByText('Fallback summary');
    Object.defineProperty(summary, 'tabIndex', { configurable: true, value: -1 });

    expect(summary.tabIndex).toBe(-1);
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(summary).toHaveFocus();
  });
});

describe('useDialogKeyboardFocus Escape consumption', () => {
  it('ignores consumed, default-prevented and composing Escape', () => {
    const onClose = vi.fn();
    render(
      <StaticHarness onClose={onClose}>
        <div data-testid="consumer"
          onKeyDown={event => {
            if (event.key !== 'Escape') return;
            if (event.currentTarget.dataset.mode === 'stop') event.stopPropagation();
            else if (event.currentTarget.dataset.mode === 'prevent') event.preventDefault();
          }} />
      </StaticHarness>,
    );
    const consumer = screen.getByTestId('consumer');

    consumer.dataset.mode = 'stop';
    fireEvent.keyDown(consumer, { key: 'Escape' });
    consumer.dataset.mode = 'prevent';
    fireEvent.keyDown(consumer, { key: 'Escape' });
    consumer.dataset.mode = 'none';
    fireEvent.keyDown(consumer, { key: 'Escape', isComposing: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once per open, prevents the default and ignores repeats', () => {
    const onClose = vi.fn();
    const windowKeyDown = vi.fn();
    window.addEventListener('keydown', windowKeyDown);
    render(<StaticHarness onClose={onClose} />);
    const close = screen.getByRole('button', { name: 'Close' });

    const firstResult = fireEvent.keyDown(close, { key: 'Escape' });
    fireEvent.keyDown(close, { key: 'Escape' });
    fireEvent.keyDown(close, { key: 'Escape', repeat: true });

    expect(firstResult).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(windowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener('keydown', windowKeyDown);
  });
});
