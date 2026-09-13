import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameProvider, useDispatch, useGameState } from './GameContext';
import { createInitialState } from './initialState';

function Harness({ current }) {
  current.state = useGameState();
  current.dispatch = useDispatch();
  return null;
}

function renderReducer(overrides = {}) {
  const initial = createInitialState();
  const saved = {
    ...initial,
    ...overrides,
    restaurant: { ...initial.restaurant, ...(overrides.restaurant || {}) },
  };
  localStorage.setItem('restaurant-sim-save', JSON.stringify(saved));
  const current = {};
  render(<GameProvider><Harness current={current} /></GameProvider>);
  return {
    dispatch(action) {
      act(() => current.dispatch(action));
    },
    get state() {
      return current.state;
    },
  };
}

describe('GameProvider COPY_FIXTURES action', () => {
  beforeEach(() => localStorage.clear());

  it('charges the authoritative catalogue total and commits fresh pristine copies atomically', () => {
    const game = renderReducer({
      restaurant: { funds: 1000 },
      tables: [{
        id: 't1', seats: 2, status: 'occupied', x: 200, y: 200,
        diningPartyId: 'party', diningCustomerIds: ['customer'],
      }],
      chairs: [
        { id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 },
        { id: 'ch2', tableId: 't1', x: 210, y: 240, rotation: 0 },
      ],
      customers: [{ id: 'customer', state: 'eating', tableId: 't1', chairId: 'ch1' }],
      serviceItems: [{ id: 'dirty', state: 'on_service', serviceTableId: 'st1' }],
    });

    game.dispatch({
      type: 'COPY_FIXTURES',
      price: 1,
      items: [{ type: 'table', id: 't1', x: 600, y: 300 }],
    });

    expect(game.state.restaurant.funds).toBe(600);
    expect(game.state.tables.at(-1)).toEqual({ id: 't2', seats: 2, status: 'empty', x: 600, y: 300 });
    expect(game.state.chairs.slice(-2)).toEqual([
      { id: 'ch3', tableId: 't2', x: 610, y: 280, rotation: 2 },
      { id: 'ch4', tableId: 't2', x: 610, y: 340, rotation: 0 },
    ]);
    expect(game.state.customers).toHaveLength(1);
    expect(game.state.serviceItems).toHaveLength(1);
  });

  it.each([
    ['insufficient funds', { restaurant: { funds: 399 } }, [{ type: 'table', id: 't1', x: 600, y: 300 }]],
    ['stale source', {}, [{ type: 'table', id: 'missing', x: 600, y: 300 }]],
    ['invalid layout', {}, [{ type: 'table', id: 't1', x: 200, y: 200 }]],
  ])('leaves state unchanged for %s', (_label, overrides, items) => {
    const game = renderReducer(overrides);
    const before = game.state;

    game.dispatch({ type: 'COPY_FIXTURES', items });

    expect(game.state).toBe(before);
  });
});
