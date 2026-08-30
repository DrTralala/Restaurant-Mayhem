import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state/initialState';
import { getRestaurantWorld } from '../simulation/world';
import { getPlaceable } from './placeables';
import {
  FIXTURE_TYPES,
  getFixture,
  getFixtureLabel,
  getFixtureRect,
  listFixtures,
} from './fixtures';

describe('fixture catalogue', () => {
  it('lists every public fixture type in stable order', () => {
    const expected = [
      'table',
      'chair',
      'door',
      'serviceTable',
      'cashierTable',
      'kitchenStation',
      'washStation',
    ];
    const fixtures = listFixtures(createInitialState());

    expect(Object.keys(FIXTURE_TYPES)).toEqual(expected);
    expect(fixtures.map(item => item.type)).toEqual(expect.arrayContaining(expected));
    expect(fixtures).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'table', id: 't1', data: expect.any(Object) }),
      expect.objectContaining({ type: 'chair', id: 'ch1', data: expect.any(Object) }),
    ]));
  });

  it('adapts door and service-counter geometry to the canonical footprints', () => {
    const state = createInitialState();

    expect(getFixtureRect(state, {
      type: 'door', id: 'door1', data: state.doors[0],
    })).toEqual({ x: getRestaurantWorld(state.restaurant).doorX, y: 340, w: 6, h: 40 });
    expect(getFixtureRect(state, {
      type: 'serviceTable', id: 'st1', data: state.serviceTables[0],
    })).toEqual({ x: 140, y: 120, w: 120, h: 40 });
  });

  it('uses one public wash-station type for manual and automatic stations', () => {
    const state = {
      ...createInitialState(),
      washStations: [
        { id: 'manual1', type: 'manual', x: 20, y: 40 },
        { id: 'automatic1', type: 'automatic', x: 80, y: 40, w: 60, h: 20 },
      ],
    };
    const washFixtures = listFixtures(state).filter(item => item.type === 'washStation');

    expect(washFixtures.map(item => item.id)).toEqual(['manual1', 'automatic1']);
    expect(getFixtureRect(state, washFixtures[0])).toEqual({ x: 20, y: 40, w: 40, h: 40 });
    expect(getFixtureRect(state, washFixtures[1])).toEqual({ x: 80, y: 40, w: 60, h: 20 });
    expect(getFixtureLabel(state, washFixtures[0])).toBe('Sink');
    expect(getFixtureLabel(state, washFixtures[1])).toBe('Automatic dishwasher');
  });

  it('returns null when a fixture type or id is unknown', () => {
    const state = createInitialState();

    expect(getFixture(state, 'unknown', 'missing')).toBeNull();
    expect(getFixture(state, 'table', 'missing')).toBeNull();
  });

  it('provides non-shop geometry for existing stations and equipment placement', () => {
    expect(getPlaceable('kitchenStation')).toMatchObject({
      price: null, width: 40, height: 40, grid: 20,
    });
    expect(getPlaceable('manualSink')).toMatchObject({
      price: null, width: 40, height: 40, grid: 20,
    });
    expect(getPlaceable('equipmentStation')).toMatchObject({
      price: null, width: 40, height: 40, grid: 20,
    });
  });
});
