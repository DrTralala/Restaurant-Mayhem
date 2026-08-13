import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameProvider, useDispatch, useGameState } from './GameContext';

function StaffNameHarness() {
  const state = useGameState();
  const dispatch = useDispatch();

  return (
    <>
      <span>{state.staff[0].name}</span>
      <span>${state.staff[0].salary}</span>
      <button onClick={() => dispatch({ type: 'RENAME_STAFF', id: state.staff[0].id, name: 'Matteo' })}>
        Rename starter
      </button>
      <button onClick={() => dispatch({ type: 'SET_STAFF_SALARY', id: state.staff[0].id, salary: 240 })}>
        Raise starter
      </button>
    </>
  );
}

function TableHarness() {
  const state = useGameState();
  const dispatch = useDispatch();
  const newestTableId = state.tables.at(-1).id;
  const rotations = state.chairs
    .filter(chair => chair.tableId === newestTableId)
    .map(chair => chair.rotation)
    .join(',');

  return (
    <>
      <span data-testid="newest-chair-rotations">{rotations}</span>
      <button onClick={() => dispatch({ type: 'ADD_TABLE' })}>Add table</button>
    </>
  );
}

function ItemHarness() {
  const state = useGameState();
  const dispatch = useDispatch();
  return (
    <>
      <span data-testid="funds">{state.restaurant.funds}</span>
      <span data-testid="table-count">{state.tables.length}</span>
      <span data-testid="chair-count">{state.chairs.length}</span>
      <span data-testid="door-count">{state.doors.length}</span>
      <button onClick={() => dispatch({ type: 'BUY_TABLE', cost: 300 })}>Buy table</button>
      <button onClick={() => dispatch({ type: 'BUY_CHAIR', cost: 50 })}>Buy chair</button>
      <button onClick={() => dispatch({ type: 'SELL_ITEMS', items: [{ type: 'chair', id: 'ch1' }] })}>Sell chair</button>
      <button onClick={() => dispatch({ type: 'BUY_DOOR', cost: 400 })}>Buy door</button>
    </>
  );
}

describe('GameProvider staff actions', () => {
  beforeEach(() => localStorage.clear());

  it('renames only the selected staff member', () => {
    render(
      <GameProvider>
        <StaffNameHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Rename starter' }).click());

    expect(screen.getByText('Matteo')).toBeInTheDocument();
  });

  it('updates only the selected staff salary', () => {
    render(
      <GameProvider>
        <StaffNameHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Raise starter' }).click());

    expect(screen.getByText('$240')).toBeInTheDocument();
  });
});

describe('GameProvider furniture actions', () => {
  beforeEach(() => localStorage.clear());

  it('faces chairs added with a table inwards', () => {
    render(
      <GameProvider>
        <TableHarness />
      </GameProvider>,
    );

    act(() => screen.getByRole('button', { name: 'Add table' }).click());

    expect(screen.getByTestId('newest-chair-rotations')).toHaveTextContent('2,0,1,3');
  });

  it('buys tables and chairs while deducting their item prices', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Buy table' }).click());
    expect(screen.getByTestId('funds')).toHaveTextContent('300');
    expect(screen.getByTestId('table-count')).toHaveTextContent('5');

    act(() => screen.getByRole('button', { name: 'Buy chair' }).click());
    expect(screen.getByTestId('funds')).toHaveTextContent('250');
    expect(screen.getByTestId('chair-count')).toHaveTextContent('13');
  });

  it('refunds half the chair price when selling selected furniture', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Sell chair' }).click());

    expect(screen.getByTestId('funds')).toHaveTextContent('625');
    expect(screen.getByTestId('chair-count')).toHaveTextContent('11');
  });

  it('buys an additional door and deducts its item price', () => {
    render(<GameProvider><ItemHarness /></GameProvider>);

    act(() => screen.getByRole('button', { name: 'Buy door' }).click());

    expect(screen.getByTestId('funds')).toHaveTextContent('200');
    expect(screen.getByTestId('door-count')).toHaveTextContent('2');
  });
});
