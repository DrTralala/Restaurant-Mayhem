import { describe, expect, it } from 'vitest';
import { validatePlacement } from '../simulation/placement';
import {
  buildPlacement,
  getPlacementLabel,
  samePlacement,
} from './placementInteraction';

const emptyState = {
  restaurant: { expansionLevel: 1 },
  tables: [],
  chairs: [],
  doors: [],
  serviceTables: [],
  cashierStations: [],
  kitchenStations: [],
  washStations: [],
  staffAmenities: [],
};

describe('placement interaction helpers', () => {
  it('validates a normal placement with the canonical placement validator', () => {
    const request = { itemType: 'table' };
    const point = { x: 600, y: 300 };
    const candidate = { ...request, ...point, rotation: 0 };

    expect(buildPlacement(emptyState, request, point)).toEqual({
      ...candidate,
      ...validatePlacement(emptyState, candidate),
    });
  });

  it.each([
    ['validity', { valid: false }],
    ['reason', { reason: 'overlap' }],
    ['table target', { tableId: 't2' }],
  ])('detects a changed %s', (_field, change) => {
    const placement = {
      itemType: 'chair',
      x: 200,
      y: 180,
      rotation: 0,
      valid: true,
      reason: null,
      tableId: 't1',
    };

    expect(samePlacement(placement, { ...placement, ...change })).toBe(false);
  });

  it('prefers the equipment name for an equipment placement label', () => {
    const state = { equipment: [{ id: 'eq1', name: 'Espresso Machine' }] };

    expect(getPlacementLabel(state, {
      itemType: 'equipmentStation',
      equipmentId: 'eq1',
    })).toBe('Espresso Machine');
  });
});
