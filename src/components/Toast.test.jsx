import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameState } from '../state/GameContext';
import Toast from './Toast';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
}));

function advanceTime(ms) {
  act(() => vi.advanceTimersByTime(ms));
}

function focusElement(element) {
  act(() => element.focus());
}

function blurElement(element) {
  act(() => element.blur());
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameState.mockReturnValue({
      notifications: [{ id: 'milestone-1', message: 'Milestone: Serve 50 customers!' }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('allows a notification to be dismissed immediately', () => {
    render(<Toast />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));

    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('fades and removes a notification five seconds after it first appears', () => {
    const { rerender } = render(<Toast />);

    act(() => vi.advanceTimersByTime(3000));
    useGameState.mockReturnValue({
      notifications: [{ id: 'milestone-1', message: 'Milestone: Serve 50 customers!' }],
    });
    rerender(<Toast />);
    act(() => vi.advanceTimersByTime(1999));

    expect(screen.getByText('Milestone: Serve 50 customers!')).toHaveClass('toast-banner');

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('retains the remaining unfocused budget after a focus interruption', () => {
    render(<Toast />);
    const banner = screen.getByText('Milestone: Serve 50 customers!').closest('.toast-banner');
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });

    advanceTime(2000);
    focusElement(dismiss);

    expect(banner).toHaveClass('toast-banner--focused');
    advanceTime(10000);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    blurElement(dismiss);
    expect(banner).not.toHaveClass('toast-banner--focused');
    advanceTime(2999);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    advanceTime(1);
    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('pauses a late focus at 4.9 seconds and resumes the final 100 milliseconds', () => {
    render(<Toast />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });

    advanceTime(4900);
    focusElement(dismiss);
    advanceTime(10000);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    blurElement(dismiss);
    advanceTime(99);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    advanceTime(1);
    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('does not resume when focus moves between descendants of the banner', () => {
    render(<Toast />);
    const banner = screen.getByText('Milestone: Serve 50 customers!').closest('.toast-banner');
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });
    const nested = document.createElement('button');
    nested.type = 'button';
    nested.textContent = 'Nested control';
    banner.appendChild(nested);

    advanceTime(2000);
    focusElement(dismiss);
    focusElement(nested);
    advanceTime(10000);

    expect(banner).toHaveClass('toast-banner--focused');
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    blurElement(nested);
    advanceTime(2999);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    advanceTime(1);
    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('consumes only unfocused time across repeated focus visits', () => {
    render(<Toast />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });

    advanceTime(2000);
    focusElement(dismiss);
    advanceTime(10000);
    blurElement(dismiss);
    advanceTime(1000);
    focusElement(dismiss);
    advanceTime(10000);

    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    blurElement(dismiss);
    advanceTime(1999);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    advanceTime(1);
    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('runs independent lifetime budgets for multiple banners', () => {
    const { rerender } = render(<Toast />);
    const first = { id: 'milestone-1', message: 'Milestone: Serve 50 customers!' };
    const second = { id: 'milestone-2', message: 'Second notification' };

    advanceTime(1000);
    useGameState.mockReturnValue({ notifications: [first, second] });
    rerender(<Toast />);

    expect(screen.getByText('Second notification')).toBeInTheDocument();
    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss notification' });
    expect(dismissButtons).toHaveLength(2);

    focusElement(dismissButtons[0]);
    advanceTime(5000);
    expect(screen.queryByText('Second notification')).not.toBeInTheDocument();
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    blurElement(dismissButtons[0]);
    advanceTime(3999);
    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();

    advanceTime(1);
    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('dismisses immediately on a manual click while focused', () => {
    render(<Toast />);
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });

    advanceTime(4000);
    focusElement(dismiss);
    fireEvent.click(dismiss);

    expect(screen.queryByText('Milestone: Serve 50 customers!')).not.toBeInTheDocument();
  });

  it('does not dismiss from an expired timer while focus is still inside the banner', () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    render(<Toast />);
    const expire = timeoutSpy.mock.calls.find(([, delay]) => delay === 5000)?.[0];
    const dismiss = screen.getByRole('button', { name: 'Dismiss notification' });

    expect(expire).toBeTypeOf('function');
    focusElement(dismiss);
    act(() => expire());

    expect(screen.getByText('Milestone: Serve 50 customers!')).toBeInTheDocument();
  });

  it('clears the pending timer when a banner unmounts', () => {
    const { unmount } = render(<Toast />);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pauses the animation and forces a focused banner opaque in the stylesheet', () => {
    const css = readFileSync('src/App.css', 'utf8');
    const focusedRule = css.match(/\.toast-banner\.toast-banner--focused[^{]*\{([^}]*)\}/)?.[1] || '';

    expect(focusedRule).toContain('animation-play-state: paused');
    expect(focusedRule).toContain('opacity: 1 !important');
    expect(focusedRule).toContain('transform: translateY(0) !important');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.toast-banner\s*\{[^}]*animation:\s*none/);
  });
});
