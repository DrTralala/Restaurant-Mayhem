import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HoursPanel from './HoursPanel';

const dispatch = vi.fn();
const mockState = {
  restaurant: { openHour: 10, closeHour: 22 },
};

vi.mock('../state/GameContext', () => ({
  useGameState: () => mockState,
  useDispatch: () => dispatch,
}));

describe('HoursPanel', () => {
  beforeEach(() => {
    dispatch.mockClear();
    mockState.restaurant.openHour = 10;
    mockState.restaurant.closeHour = 22;
  });

  it('dispatches half-hour opening and closing values atomically', () => {
    render(<HoursPanel />);

    fireEvent.change(screen.getByLabelText('Opening time'), { target: { value: '18.5' } });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'SET_OPERATING_HOURS', openHour: 18.5, closeHour: 22,
    });
  });

  it('preserves opening time when changing closing time', () => {
    mockState.restaurant.openHour = 18.5;
    render(<HoursPanel />);

    fireEvent.change(screen.getByLabelText('Closing time'), { target: { value: '2' } });

    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'SET_OPERATING_HOURS', openHour: 18.5, closeHour: 2,
    });
  });

  it('offers every half hour and describes same-day and overnight schedules', () => {
    const { rerender } = render(<HoursPanel />);

    expect(screen.getByLabelText('Opening time')).toHaveDisplayValue('10:00 AM');
    expect(screen.getAllByRole('option')).toHaveLength(96);
    expect(screen.getByText('10:00 AM–10:00 PM')).toBeInTheDocument();

    mockState.restaurant.openHour = 18.5;
    mockState.restaurant.closeHour = 2;
    rerender(<HoursPanel />);
    expect(screen.getByText('6:30 PM–2:00 AM (next day)')).toBeInTheDocument();
  });

  it('labels equal times as open 24 hours', () => {
    mockState.restaurant.openHour = 0;
    mockState.restaurant.closeHour = 0;

    render(<HoursPanel />);

    expect(screen.getByText('Open 24 hours')).toBeInTheDocument();
  });
});
