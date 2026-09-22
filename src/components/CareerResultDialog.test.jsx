import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CareerResultDialog from './CareerResultDialog';

afterEach(() => vi.restoreAllMocks());
const summary = (overrides = {}) => ({
  title: 'Opening Week', status: 'lost', deadlineAt: 640800, remainingSeconds: 0,
  criteria: [
    { id: 'paid-meals', actual: 73, target: 80, passed: false },
    { id: 'reputation', actual: 2.13, target: 2, passed: true },
  ], needsDecision: true, issue: null, ...overrides,
});

describe('CareerResultDialog', () => {
  it.each([null, summary({ needsDecision: false, status: 'continued' })])('renders no modal without a decision (%j)', value => {
    render(<CareerResultDialog summary={value} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows both frozen criteria with reasons, exact evaluation time and explicit choices', () => {
    render(<CareerResultDialog summary={summary()} />);
    const dialog = screen.getByRole('dialog', { name: 'Opening Week target missed' });
    expect(within(dialog).getByRole('list', { name: 'Opening Week results' })).toBeInTheDocument();
    expect(screen.getByText('Paid meals: 73 / 80 — 7 more were needed')).toBeInTheDocument();
    expect(screen.getByText('Reputation: 2.13 / 2.00 — met')).toBeInTheDocument();
    expect(screen.getByText(/Evaluated: Day 8, 10:00 AM/)).toBeInTheDocument();
    expect(screen.getByText(/Debt and profit were not scored/)).toBeInTheDocument();
    expect(screen.getByText(/explicit choice/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Opening Week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue as sandbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
  it('explains a win without rewards or bankruptcy framing', () => {
    render(<CareerResultDialog summary={summary({ status: 'won', criteria: [
      { id: 'paid-meals', actual: 80, target: 80, passed: true },
      { id: 'reputation', actual: 2, target: 2, passed: true },
    ] })} />);
    expect(screen.getByRole('dialog', { name: 'Opening Week complete' })).toBeInTheDocument();
    expect(screen.getByText(/Both targets were met/)).toBeInTheDocument();
  });
  it('never presents rounded 1.999 reputation as a pass', () => {
    render(<CareerResultDialog summary={summary({ criteria: [
      { id: 'paid-meals', actual: 80, target: 80, passed: true },
      { id: 'reputation', actual: 1.999, target: 2, passed: false },
    ] })} />);
    expect(screen.getByText(/Reputation: 1.999 \/ 2.00/)).toHaveTextContent(/below target/);
    expect(screen.getByText('Paid meals: 80 / 80 — met')).toBeInTheDocument();
  });
  it('cancels destructive Retry without invoking any callback and restores Retry focus', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onRetry = vi.fn();
    const onContinue = vi.fn();
    render(<CareerResultDialog summary={summary()} onRetry={onRetry} onContinue={onContinue} />);
    const retry = screen.getByRole('button', { name: 'Retry Opening Week' });
    fireEvent.click(retry);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/replaces your current restaurant and its local autosave/));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/No backup is created/));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/arrivals and tips will differ/i));
    expect(onRetry).not.toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
    expect(retry).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('invokes Retry once only after explicit confirmation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onRetry = vi.fn();
    render(<CareerResultDialog summary={summary()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Opening Week' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith();
  });
  it('continues without destructive confirmation while explaining any remaining technical stop', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const onContinue = vi.fn();
    render(<CareerResultDialog summary={summary()} onContinue={onContinue}
      blockedReason="Navigation recovery is still required." />);
    expect(screen.getByText(/Navigation recovery is still required/)).toBeInTheDocument();
    expect(screen.getByText(/still stopped/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue as sandbox' }));
    expect(onContinue).toHaveBeenCalledWith();
    expect(confirm).not.toHaveBeenCalled();
  });
  it('focuses the labelled heading, contains keyboard and programmatic focus, and ignores Escape/backdrop', () => {
    const onContinue = vi.fn();
    render(<><button>Outside</button><CareerResultDialog summary={summary()} onContinue={onContinue} /></>);
    const dialog = screen.getByRole('dialog');
    const title = screen.getByRole('heading', { name: 'Opening Week target missed' });
    expect(title).toHaveFocus();
    fireEvent.keyDown(title, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Retry Opening Week' })).toHaveFocus();
    screen.getByRole('button', { name: 'Outside' }).focus();
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    fireEvent.click(dialog.parentElement);
    expect(onContinue).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
  });
  it('does not leak Space to the global pause shortcut', () => {
    const globalKey = vi.fn();
    window.addEventListener('keydown', globalKey);
    try {
      render(<CareerResultDialog summary={summary()} />);
      fireEvent.keyDown(document.activeElement, { key: ' ', code: 'Space' });
      expect(globalKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', globalKey);
    }
  });
  it('restores the entry focus on controlled Continue and releases the trap', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Opening Week entry</button>
        <CareerResultDialog summary={open ? summary() : null} onContinue={() => setOpen(false)} /></>;
    }
    render(<Harness />);
    const entry = screen.getByRole('button', { name: 'Opening Week entry' });
    entry.focus();
    fireEvent.click(entry);
    fireEvent.click(screen.getByRole('button', { name: 'Continue as sandbox' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
  });
  it('lets the parent replace the presentation with Settings without clearing the decision', () => {
    const frozen = summary();
    function Harness() {
      const [settings, setSettings] = useState(false);
      return settings ? <section><button autoFocus onClick={() => setSettings(false)}>Close Settings</button>
        <button>Load game</button></section>
        : <CareerResultDialog summary={frozen} onOpenSettings={() => setSettings(true)} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Load game' }).focus();
    expect(screen.getByRole('button', { name: 'Load game' })).toHaveFocus();
    expect(frozen.needsDecision).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close Settings' }));
    expect(screen.getByRole('heading', { name: 'Opening Week target missed' })).toHaveFocus();
  });
  it('routes invalid progress to non-scoring Continue, normal Start confirmation and Settings, not Retry', () => {
    const onStartNew = vi.fn();
    const onRetry = vi.fn();
    render(<CareerResultDialog summary={summary({ status: 'invalid', criteria: null,
      issue: 'unsupported-career-version' })} onStartNew={onStartNew} onRetry={onRetry} />);
    expect(screen.getByRole('dialog', { name: 'Opening Week progress cannot be verified' })).toBeInTheDocument();
    expect(screen.getByText(/not a win or loss/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry Opening Week' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Evaluated:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start new Opening Week' }));
    expect(onStartNew).toHaveBeenCalledWith();
    expect(onRetry).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue as sandbox' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });
});
