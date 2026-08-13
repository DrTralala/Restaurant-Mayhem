import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SpeedControls from './SpeedControls';

vi.mock('../state/GameContext', () => ({
  useGameState: () => ({ paused: false, speed: 1 }),
  useDispatch: () => vi.fn(),
}));

describe('SpeedControls', () => {
  it('renders the bottom control row in AMOLED black', () => {
    render(<SpeedControls />);

    expect(screen.getByRole('button', { name: '1x' }).parentElement).toHaveStyle({
      background: '#000000',
    });
  });

  it('requests a whole-layout fit from the bottom control row', () => {
    const onFit = vi.fn();
    render(<SpeedControls onFit={onFit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));

    expect(onFit).toHaveBeenCalledOnce();
  });
});
