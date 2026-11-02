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
