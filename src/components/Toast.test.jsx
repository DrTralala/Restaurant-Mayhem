import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameState } from '../state/GameContext';
import Toast from './Toast';

vi.mock('../state/GameContext', () => ({
  useGameState: vi.fn(),
}));

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useGameState.mockReturnValue({
      notifications: [{ id: 'milestone-1', message: 'Milestone: Serve 50 customers!' }],
    });
  });

  afterEach(() => {
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
});
