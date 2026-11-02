import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HoursPanel from './HoursPanel';
import { RUSH_PERIODS } from '../simulation/clock';

const dispatch = vi.fn();
const mockState = {
  restaurant: { openHour: 10, closeHour: 22 },
  staff: [],
};

vi.mock('../state/GameContext', () => ({
  useGameState: () => mockState,
  useDispatch: () => dispatch,
}));

const scheduleForPeaks = modes => {
  const schedule = Array(48).fill('rest');
  RUSH_PERIODS.forEach((period, index) => {
    if (modes[index]) schedule[period.peakHour * 2] = 'work';
  });
  return schedule;
};

const peakRoster = () => [
  { role: 'cook', effectiveDuty: 'rest', schedule: scheduleForPeaks([true, true, true]) },
  { role: 'waiter', effectiveDuty: 'work', schedule: scheduleForPeaks([true, false, true]) },
  { role: 'janitor', effectiveDuty: 'pto', schedule: scheduleForPeaks([false, true, false]) },
];

describe('HoursPanel', () => {
  beforeEach(() => {
    dispatch.mockClear();
    mockState.restaurant = { openHour: 10, closeHour: 22 };
    mockState.staff = [];
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

  it('dispatches pause and resume with an accessible pressed state', () => {
    const { rerender } = render(<HoursPanel />);
    const pause = screen.getByRole('button', { name: 'Pause walk-ins' });
    expect(pause).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(pause);

    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_WALK_INS_PAUSED', paused: true });

    mockState.restaurant.walkInsPaused = true;
    rerender(<HoursPanel />);
    const resume = screen.getByRole('button', { name: 'Resume walk-ins' });
    expect(resume).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(resume);

    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_WALK_INS_PAUSED', paused: false });
  });

  it('shows the walk-in status and continuity copy in both states', () => {
    const { rerender } = render(<HoursPanel />);

    expect(screen.getByRole('heading', { name: 'Walk-in arrivals' })).toBeInTheDocument();
    expect(screen.getByText('Accepting walk-ins during opening hours')).toBeInTheDocument();
    expect(screen.getByText(
      'Only new walk-ins are paused. Queued and seated guests continue service; booked contract guests still arrive during opening hours.',
    )).toBeInTheDocument();

    mockState.restaurant.walkInsPaused = true;
    rerender(<HoursPanel />);

    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('Accepting walk-ins during opening hours')).not.toBeInTheDocument();
  });

  const rushRows = () => within(
    screen.getByRole('list', { name: 'Rush-period coverage' }),
  ).getAllByRole('listitem');

  it('shows saved Scheduled Work counts at all three canonical peaks without adding controls', () => {
    mockState.restaurant = { openHour: 0, closeHour: 0 };
    mockState.staff = peakRoster();

    render(<HoursPanel />);

    const rows = rushRows();
    expect(rows).toHaveLength(RUSH_PERIODS.length);
    expect(within(rows[0]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 1 · Janitors 0',
    )).toBeInTheDocument();
    expect(within(rows[1]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 0 · Janitors 1',
    )).toBeInTheDocument();
    expect(within(rows[2]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 1 · Janitors 0',
    )).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getAllByRole('option')).toHaveLength(96);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('shows zero counts for an empty roster when the peak is open', () => {
    mockState.restaurant = { openHour: 0, closeHour: 0 };

    render(<HoursPanel />);

    expect(rushRows().every(row => within(row).getByText(
      'Scheduled Work at peak: Cooks 0 · Waiters 0 · Janitors 0',
    ))).toBe(true);
  });

  it('updates counts when a saved schedule changes at an exact half-hour peak', () => {
    mockState.restaurant = { openHour: 12.5, closeHour: 14 };
    const schedule = scheduleForPeaks([true, true, true]);
    mockState.staff = [{ role: 'cook', effectiveDuty: 'rest', schedule }];
    const { rerender } = render(<HoursPanel />);

    expect(within(rushRows()[1]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 0 · Janitors 0',
    )).toBeInTheDocument();

    const updatedSchedule = [...schedule];
    updatedSchedule[RUSH_PERIODS[1].peakHour * 2] = 'rest';
    mockState.staff = [{ role: 'cook', effectiveDuty: 'work', schedule: updatedSchedule }];
    rerender(<HoursPanel />);

    expect(within(rushRows()[1]).getByText(
      'Scheduled Work at peak: Cooks 0 · Waiters 0 · Janitors 0',
    )).toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('updates peak-time coverage when opening or closing exactly at the lunch peak', () => {
    mockState.staff = peakRoster();
    mockState.restaurant = { ...mockState.restaurant, openHour: 10, closeHour: 12.5 };
    const { rerender } = render(<HoursPanel />);
    expect(within(rushRows()[1]).getByText('Closed at peak time.')).toBeInTheDocument();
    expect(within(rushRows()[1]).queryByText(/Scheduled Work at peak:/)).not.toBeInTheDocument();

    mockState.restaurant = { ...mockState.restaurant, openHour: 12.5, closeHour: 14 };
    rerender(<HoursPanel />);
    expect(within(rushRows()[1]).getByText('Open at peak time.')).toBeInTheDocument();
    expect(within(rushRows()[1]).queryByText('Closed at peak time.')).not.toBeInTheDocument();
    expect(within(rushRows()[1]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 0 · Janitors 1',
    )).toBeInTheDocument();
    expect(within(rushRows()[0]).getByText('Closed at peak time.')).toBeInTheDocument();

    mockState.restaurant = { ...mockState.restaurant, openHour: 19, closeHour: 7 };
    rerender(<HoursPanel />);
    expect(within(rushRows()[0]).getByText('Closed at peak time.')).toBeInTheDocument();
    expect(within(rushRows()[0]).queryByText(/Scheduled Work at peak:/)).not.toBeInTheDocument();
    expect(within(rushRows()[2]).getByText('Closed at peak time.')).toBeInTheDocument();
    expect(within(rushRows()[2]).queryByText(/Scheduled Work at peak:/)).not.toBeInTheDocument();
  });

  it('renders rush-period coverage for a partial morning window', () => {
    mockState.restaurant.openHour = 6;
    mockState.restaurant.closeHour = 6.5;

    render(<HoursPanel />);

    expect(screen.getByRole('region', { name: 'Rush periods' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rush periods' })).toBeInTheDocument();
    const rows = rushRows();
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText('Breakfast')).toBeInTheDocument();
    expect(within(rows[0]).getByText('6:00 AM–8:00 AM')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Full-window peak: 2× at 7:00 AM.')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Open for 0.5 of 2 hours.')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Partly open')).toBeInTheDocument();

    expect(within(rows[1]).getByText('Lunch')).toBeInTheDocument();
    expect(within(rows[1]).getByText('11:00 AM–2:00 PM')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Full-window peak: 2.5× at 12:30 PM.')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Open for 0 of 3 hours.')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Closed throughout')).toBeInTheDocument();

    expect(within(rows[2]).getByText('Dinner')).toBeInTheDocument();
    expect(within(rows[2]).getByText('5:00 PM–8:00 PM')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Full-window peak: 3× at 6:30 PM.')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Open for 0 of 3 hours.')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Closed throughout')).toBeInTheDocument();
  });

  it('shows all-day and overnight coverage with the right statuses', () => {
    const { rerender } = render(<HoursPanel />);

    expect(within(rushRows()[0]).getByText('Closed throughout')).toBeInTheDocument();
    expect(within(rushRows()[1]).getByText('Open throughout')).toBeInTheDocument();
    expect(within(rushRows()[2]).getByText('Open throughout')).toBeInTheDocument();

    mockState.restaurant.openHour = 19;
    mockState.restaurant.closeHour = 7;
    rerender(<HoursPanel />);

    const overnight = rushRows();
    expect(within(overnight[0]).getByText('Open for 1 of 2 hours.')).toBeInTheDocument();
    expect(within(overnight[0]).getByText('Partly open')).toBeInTheDocument();
    expect(within(overnight[1]).getByText('Open for 0 of 3 hours.')).toBeInTheDocument();
    expect(within(overnight[1]).getByText('Closed throughout')).toBeInTheDocument();
    expect(within(overnight[2]).getByText('Open for 1 of 3 hours.')).toBeInTheDocument();
    expect(within(overnight[2]).getByText('Partly open')).toBeInTheDocument();

    mockState.restaurant.openHour = 0;
    mockState.restaurant.closeHour = 0;
    rerender(<HoursPanel />);

    const allDay = rushRows();
    expect(allDay.every(row => within(row).queryByText('Open throughout'))).toBe(true);
    expect(within(allDay[1]).getByText('Open for 3 of 3 hours.')).toBeInTheDocument();
  });

  it('keeps rush coverage unchanged while paused and shows the pause notice', () => {
    mockState.restaurant.openHour = 6.5;
    mockState.restaurant.closeHour = 7.5;
    mockState.staff = peakRoster();
    const { rerender } = render(<HoursPanel />);
    const coverage = () => rushRows().map(row => row.textContent);

    expect(screen.queryByText(
      'Walk-ins are paused; this opening-hours preview does not resume them.',
    )).not.toBeInTheDocument();
    const before = coverage();
    expect(within(rushRows()[0]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 1 · Janitors 0',
    )).toBeInTheDocument();

    mockState.restaurant.walkInsPaused = true;
    rerender(<HoursPanel />);

    expect(coverage()).toEqual(before);
    expect(within(rushRows()[0]).getByText(
      'Scheduled Work at peak: Cooks 1 · Waiters 1 · Janitors 0',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'Walk-ins are paused; this opening-hours preview does not resume them.',
    )).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume walk-ins' })).toBeInTheDocument();
  });

  it('renders the rush-period caveat with no new controls', () => {
    render(<HoursPanel />);

    const region = screen.getByRole('region', { name: 'Rush periods' });
    expect(within(region).getByText(
      'These multipliers affect random walk-in arrival rates, not guaranteed guests or sales. Full-window peaks may fall outside your opening hours. Booked contract arrivals follow their own schedule.',
    )).toBeInTheDocument();
    expect(within(region).getByText(
      'Scheduled Work counts use saved schedules only, not unsaved editor drafts, actual availability, capacity or staffing requirements.',
    )).toBeInTheDocument();
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
    expect(within(region).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps the opening-hours controls working when coverage updates on rerender', () => {
    const { rerender } = render(<HoursPanel />);

    expect(screen.getAllByRole('option')).toHaveLength(96);
    fireEvent.change(screen.getByLabelText('Closing time'), { target: { value: '6.5' } });
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'SET_OPERATING_HOURS', openHour: 10, closeHour: 6.5,
    });

    mockState.restaurant.openHour = 6;
    mockState.restaurant.closeHour = 6.5;
    rerender(<HoursPanel />);

    expect(screen.getByText('6:00 AM–6:30 AM')).toBeInTheDocument();
    expect(within(rushRows()[0]).getByText('Open for 0.5 of 2 hours.')).toBeInTheDocument();
  });
});
