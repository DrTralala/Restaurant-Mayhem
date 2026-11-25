import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import TableSeatingHolds from './TableSeatingHolds';

const { mockUseGameState, mockUseDispatch } = vi.hoisted(() => ({
  mockUseGameState: vi.fn(),
  mockUseDispatch: vi.fn(),
}));

vi.mock('../state/GameContext', () => ({
  useGameState: () => mockUseGameState(),
  useDispatch: () => mockUseDispatch,
}));

beforeEach(() => {
  mockUseGameState.mockReturnValue({ tables: [] });
  mockUseDispatch.mockClear();
});

const queuedParty = (id, size) => ({
  partyId: id,
  members: Array.from({ length: size }, (_value, index) => ({ id: `${id}-${index}` })),
});

it('shows current table status and permits holding empty or releasing a stale occupied hold', () => {
  mockUseGameState.mockReturnValue({
    tables: [
      { id: 1, status: 'empty' },
      { id: 2, status: 'occupied' },
      { id: 3, status: 'occupied', admissionHeld: true },
    ],
  });
  render(<TableSeatingHolds />);

  const section = screen.getByRole('region', { name: 'Table seating holds' });
  expect(within(section).getByText('Status: empty')).toBeInTheDocument();
  expect(within(section).getAllByText('Status: occupied')).toHaveLength(2);
  expect(within(section).getByRole('button', { name: 'Hold seating for table 1' }))
    .toBeEnabled();
  expect(within(section).getByRole('button', { name: 'Hold seating for table 2' }))
    .toBeDisabled();
  expect(within(section).getByRole('button', { name: 'Release seating for table 3' }))
    .toBeEnabled();
});

it('skips missing, invalid, and string-equivalent ambiguous IDs', () => {
  mockUseGameState.mockReturnValue({
    tables: [
      { status: 'empty' },
      { id: '', status: 'empty' },
      { id: -1, status: 'empty' },
      { id: 1.5, status: 'empty' },
      { id: 'duplicated', status: 'empty' },
      { id: 'duplicated', status: 'empty' },
      { id: 7, status: 'empty' },
      { id: '7', status: 'empty' },
      { id: 'usable', status: 'empty' },
    ],
  });
  render(<TableSeatingHolds />);

  const section = screen.getByRole('region', { name: 'Table seating holds' });
  expect(within(section).getAllByRole('button')).toHaveLength(1);
  expect(within(section).getByRole('button', { name: 'Hold seating for table usable' }))
    .toBeInTheDocument();
});

it.each([0, Number.MAX_SAFE_INTEGER, ' '])(
  'accepts reducer-valid table ID %s without changing its payload type', id => {
    mockUseGameState.mockReturnValue({ tables: [{ id, status: 'empty' }] });
    render(<TableSeatingHolds />);

    const button = screen.getByRole('button', {
      name: id === ' ' ? 'Hold seating for table' : `Hold seating for table ${id}`,
    });
    fireEvent.click(button);

    expect(mockUseDispatch).toHaveBeenCalledWith({
      type: 'SET_TABLE_ADMISSION_HOLD', id, held: true,
    });
  },
);

it('uses the latest rendered table state and preserves focus on a stable row through a toggle', () => {
  mockUseGameState.mockReturnValue({ tables: [{ id: 42, status: 'empty' }] });
  const { rerender } = render(<TableSeatingHolds />);
  const holdButton = screen.getByRole('button', { name: 'Hold seating for table 42' });
  holdButton.focus();
  expect(holdButton).toHaveFocus();

  mockUseGameState.mockReturnValue({
    tables: [{ id: 42, status: 'occupied', admissionHeld: true }],
  });
  rerender(<TableSeatingHolds />);

  const releaseButton = screen.getByRole('button', { name: 'Release seating for table 42' });
  expect(releaseButton).toBe(holdButton);
  expect(releaseButton).toHaveFocus();
  fireEvent.click(releaseButton);
  expect(mockUseDispatch).toHaveBeenCalledWith({
    type: 'SET_TABLE_ADMISSION_HOLD', id: 42, held: false,
  });
});

it('guards a table that became occupied before the user activates its hold button', () => {
  mockUseGameState.mockReturnValue({ tables: [{ id: 't1', status: 'empty' }] });
  const { rerender } = render(<TableSeatingHolds />);

  mockUseGameState.mockReturnValue({ tables: [{ id: 't1', status: 'occupied' }] });
  rerender(<TableSeatingHolds />);
  const button = screen.getByRole('button', { name: 'Hold seating for table t1' });
  expect(button).toBeDisabled();
  button.disabled = false;
  fireEvent.click(button);
  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it('disables changes during a pending career decision and guards the handler', () => {
  mockUseGameState.mockReturnValue({
    careerRun: { needsDecision: true },
    tables: [{ id: 't1', status: 'empty' }],
  });
  render(<TableSeatingHolds />);

  const button = screen.getByRole('button', { name: 'Hold seating for table t1' });
  expect(button).toBeDisabled();
  button.disabled = false;
  fireEvent.click(button);
  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it('provides keyboard-focusable native buttons and explains unaffected seating', () => {
  mockUseGameState.mockReturnValue({ tables: [{ id: 't1', status: 'empty' }] });
  render(<TableSeatingHolds />);

  const button = screen.getByRole('button', { name: 'Hold seating for table t1' });
  expect(button.tagName).toBe('BUTTON');
  expect(button).toHaveAttribute('type', 'button');
  expect(button.tabIndex).toBe(0);
  expect(screen.getByText(/Parties already seated, including contract guests, and existing reservations are unaffected\./))
    .toBeInTheDocument();
});

it('shows a concise empty state when there are no tables', () => {
  render(<TableSeatingHolds />);

  const section = screen.getByRole('region', { name: 'Table seating holds' });
  expect(within(section).getByText('No tables available to control.')).toBeInTheDocument();
  expect(within(section).queryByRole('button')).not.toBeInTheDocument();
});

it('dispatches the seating policy and reflects the latest persisted selection', () => {
  mockUseGameState.mockReturnValue({ restaurant: {}, tables: [] });
  const { rerender } = render(<TableSeatingHolds />);
  const selector = screen.getByRole('combobox', { name: 'Seating policy' });

  expect(selector).toHaveValue('automatic');
  expect(screen.getByText(/Automatic uses the existing table order/)).toBeInTheDocument();
  expect(screen.getByText(/walk-in and contract guests/)).toBeInTheDocument();
  fireEvent.change(selector, { target: { value: 'best-fit' } });
  expect(mockUseDispatch).toHaveBeenCalledWith({
    type: 'SET_SEATING_POLICY', policy: 'best-fit',
  });

  mockUseGameState.mockReturnValue({
    restaurant: { seatingPolicy: 'best-fit' }, tables: [],
  });
  rerender(<TableSeatingHolds />);

  expect(screen.getByRole('combobox', { name: 'Seating policy' })).toHaveValue('best-fit');
});

it('disables and guards seating policy changes during a pending career decision', () => {
  mockUseGameState.mockReturnValue({
    careerRun: { needsDecision: true }, restaurant: {}, tables: [],
  });
  render(<TableSeatingHolds />);

  const selector = screen.getByRole('combobox', { name: 'Seating policy' });
  expect(selector).toBeDisabled();
  selector.disabled = false;
  fireEvent.change(selector, { target: { value: 'best-fit' } });

  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it('offers accessible minimum choices up to physical capacity and dispatches the selected value', () => {
  mockUseGameState.mockReturnValue({
    tables: [{ id: 't1', seats: 4, status: 'empty', x: 100, y: 100 }],
    chairs: [
      { id: 'ch1', tableId: 't1', x: 100, y: 80 },
      { id: 'ch2', tableId: 't1', x: 100, y: 120 },
      { id: 'ch3', tableId: 'other', x: 100, y: 160 },
    ],
  });
  render(<TableSeatingHolds />);

  const selector = screen.getByRole('combobox', { name: 'Minimum party size for table t1' });
  expect(selector).toHaveValue('1');
  expect(within(selector).getAllByRole('option').map(option => option.value))
    .toEqual(['1', '2']);
  fireEvent.change(selector, { target: { value: '2' } });

  expect(mockUseDispatch).toHaveBeenCalledWith({
    type: 'SET_TABLE_MIN_PARTY_SIZE', id: 't1', minPartySize: 2,
  });
});

it('shows a stale minimum and chair-shortfall warning while allowing reset to Any', () => {
  mockUseGameState.mockReturnValue({
    tables: [{ id: 't1', seats: 4, status: 'empty', minPartySize: 3, x: 100, y: 100 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 80 }, { id: 'ch2', tableId: 't1', x: 100, y: 120 }],
  });
  render(<TableSeatingHolds />);

  const selector = screen.getByRole('combobox', { name: 'Minimum party size for table t1' });
  expect(selector).toHaveValue('3');
  expect(within(selector).getAllByRole('option').map(option => option.value))
    .toEqual(['1', '2', '3']);
  expect(within(selector).getByRole('option', { name: /3\+.*current/i })).toBeInTheDocument();
  expect(screen.getByText(/minimum party size 3\+ exceeds current physical capacity of 2/i))
    .toBeInTheDocument();
  fireEvent.change(selector, { target: { value: '1' } });

  expect(mockUseDispatch).toHaveBeenCalledWith({
    type: 'SET_TABLE_MIN_PARTY_SIZE', id: 't1', minPartySize: 1,
  });
});

it('counts only queued parties that fit the table and fall below its minimum', () => {
  mockUseGameState.mockReturnValue({
    tables: [{ id: 't1', seats: 4, status: 'empty', minPartySize: 3, x: 100, y: 100 }],
    chairs: Array.from({ length: 4 }, (_value, index) => ({
      id: `ch${index}`, tableId: 't1', x: 100, y: 80 + index * 20,
    })),
    queue: [queuedParty('pair-a', 2), queuedParty('pair-b', 2), queuedParty('large', 5)],
  });
  render(<TableSeatingHolds />);

  expect(screen.getByText('2 queued parties fit this table but fall below its minimum.'))
    .toBeInTheDocument();
});

it('hides the excluded-party notice when no queued party fits below the minimum', () => {
  mockUseGameState.mockReturnValue({
    tables: [{ id: 't1', seats: 4, status: 'empty', minPartySize: 3, x: 100, y: 100 }],
    chairs: Array.from({ length: 4 }, (_value, index) => ({
      id: `ch${index}`, tableId: 't1', x: 100, y: 80 + index * 20,
    })),
    queue: [queuedParty('eligible', 3), queuedParty('large', 5)],
  });
  render(<TableSeatingHolds />);

  expect(screen.queryByText(/queued parties fit this table but fall below its minimum/))
    .not.toBeInTheDocument();
});

it('does not show a minimum selector for high-top counter children', () => {
  mockUseGameState.mockReturnValue({
    tables: [{
      id: 'counter-seat', seats: 1, status: 'empty', x: 100, y: 100,
      highTopCounterId: 'counter',
    }],
    chairs: [{ id: 'counter-chair', tableId: 'counter-seat', x: 100, y: 80 }],
  });
  render(<TableSeatingHolds />);

  expect(screen.queryByRole('combobox', { name: 'Minimum party size for table counter-seat' }))
    .not.toBeInTheDocument();
});

it('disables and guards minimum changes during a pending career decision', () => {
  mockUseGameState.mockReturnValue({
    careerRun: { needsDecision: true },
    tables: [{ id: 't1', seats: 4, status: 'empty', x: 100, y: 100 }],
    chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 80 }, { id: 'ch2', tableId: 't1', x: 100, y: 120 }],
  });
  render(<TableSeatingHolds />);

  const selector = screen.getByRole('combobox', { name: 'Minimum party size for table t1' });
  expect(selector).toBeDisabled();
  selector.disabled = false;
  fireEvent.change(selector, { target: { value: '2' } });

  expect(mockUseDispatch).not.toHaveBeenCalled();
});
