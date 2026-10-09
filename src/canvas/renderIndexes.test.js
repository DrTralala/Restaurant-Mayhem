import { describe, expect, it } from 'vitest';
import { createRenderIndexes } from './renderIndexes';

describe('createRenderIndexes', () => {
  it('keeps first-match strict IDs, including undefined but excluding NaN', () => {
    const firstTable = { id: '1', label: 'string' };
    const numericTable = { id: 1, label: 'number' };
    const state = {
      tables: [firstTable, numericTable, { id: 1, label: 'duplicate' },
        { id: NaN, label: 'nan' }, { id: undefined, label: 'undefined' }, {}],
      customers: [{ id: 'customer' }],
      serviceTables: [{ id: 'counter' }],
      equipment: [{ id: 'oven' }],
      dishes: [{ id: 'dish' }],
      serviceItems: [{ id: 'item' }, { id: 'item', state: 'duplicate' }, { id: NaN }],
    };
    const indexes = createRenderIndexes(state);

    expect(indexes.tablesById.get('1')).toBe(firstTable);
    expect(indexes.tablesById.get(1)).toBe(numericTable);
    expect(indexes.tablesById.has(NaN)).toBe(false);
    expect(indexes.tablesById.get(undefined)).toMatchObject({ label: 'undefined' });
    expect(indexes.customersById.get('customer')).toBe(state.customers[0]);
    expect(indexes.serviceTablesById.get('counter')).toBe(state.serviceTables[0]);
    expect(indexes.equipmentById.get('oven')).toBe(state.equipment[0]);
    expect(indexes.dishesById.get('dish')).toBe(state.dishes[0]);
    expect(indexes.serviceItemsById.get('item')).toBe(state.serviceItems[0]);
    expect(indexes.serviceItemsById.has(NaN)).toBe(false);
  });

  it('uses strict composite chair keys and first string-coerced amenity keys', () => {
    const stringChair = { id: 'chair', tableId: 'table', label: 'string' };
    const numericTableChair = { id: 'chair', tableId: 1, label: 'number' };
    const amenities = [{ id: 1, label: 'number-first' }, { id: '1', label: 'string-second' }];
    const state = {
      chairs: [stringChair, numericTableChair, { id: 'chair', tableId: 'table', label: 'duplicate' },
        { id: NaN, tableId: 'table' }, { id: 'chair', tableId: NaN }],
      staffAmenities: amenities,
    };
    const indexes = createRenderIndexes(state);

    expect(indexes.chairsByIdAndTableId.get('chair').get('table')).toBe(stringChair);
    expect(indexes.chairsByIdAndTableId.get('chair').get(1)).toBe(numericTableChair);
    expect(indexes.chairsByIdAndTableId.has(NaN)).toBe(false);
    expect(indexes.chairsByIdAndTableId.get('chair').has(NaN)).toBe(false);
    expect(indexes.staffAmenitiesByStringId.get('1')).toBe(amenities[0]);
  });

  it('groups service items in source order and preserves duplicate group members', () => {
    const serviceItems = [
      { id: 'first', washStationId: 'wash', stationId: 'kitchen', customerId: 'customer' },
      { id: 'second', washStationId: 'wash', stationId: 'kitchen', customerId: 'customer' },
      { id: 'nan', washStationId: NaN, stationId: NaN, customerId: NaN },
    ];
    const indexes = createRenderIndexes({ serviceItems });

    expect(indexes.serviceItemsByWashStationId.get('wash')).toEqual(serviceItems.slice(0, 2));
    expect(indexes.serviceItemsByStationId.get('kitchen')).toEqual(serviceItems.slice(0, 2));
    expect(indexes.serviceItemsByCustomerId.get('customer')).toEqual(serviceItems.slice(0, 2));
    expect(indexes.serviceItemsByWashStationId.has(NaN)).toBe(false);
    expect(indexes.serviceItemsByStationId.has(NaN)).toBe(false);
    expect(indexes.serviceItemsByCustomerId.has(NaN)).toBe(false);
  });

  it('keeps delivered kinds unique in first-seen order and indexes kitchen food stations', () => {
    const serviceItems = [
      { customerId: 'c', kind: 'dish', state: 'delivered', stationId: 'k1' },
      { customerId: 'c', kind: 'drink', state: 'dirty_at_table' },
      { customerId: 'c', kind: 'dish', state: 'dirty_at_table' },
      { customerId: 'c', kind: 'other', state: 'on_service' },
      { customerId: NaN, kind: 'ignored', state: 'delivered' },
      { customerId: 'c2', kind: 'dish', state: 'preparing', stationId: 'k1' },
      { customerId: 'c2', kind: 'dish', state: 'preparing', stationId: 'k2' },
      { customerId: 'c2', kind: 'drink', state: 'ready', stationId: 'missing' },
    ];
    const indexes = createRenderIndexes({
      kitchenStations: [{ id: 'k1' }, { id: 'k2' }, { id: NaN }],
      serviceItems,
    });

    expect(indexes.deliveredKindsByCustomerId.get('c')).toEqual(['dish', 'drink']);
    expect(indexes.deliveredKindsByCustomerId.has(NaN)).toBe(false);
    expect(indexes.kitchenStationIds.has('k1')).toBe(true);
    expect(indexes.kitchenStationIds.has('missing')).toBe(false);
    expect(indexes.kitchenStationIds.has(NaN)).toBe(false);
    expect(indexes.foodKitchenStationIds.has('k1')).toBe(true);
    expect(indexes.foodKitchenStationIds.has('k2')).toBe(true);
    expect(indexes.foodKitchenStationIds.has('missing')).toBe(false);
  });

  it('indexes kitchen stations by strict ID for equipment lookup', () => {
    const firstStation = { id: 'k1', equipmentId: 'eq1' };
    const state = {
      kitchenStations: [firstStation, { id: 'k1', equipmentId: 'eq2' }, { id: NaN }],
    };
    const indexes = createRenderIndexes(state);

    expect(indexes.kitchenStationsById.get('k1')).toBe(firstStation);
    expect(indexes.kitchenStationsById.has(NaN)).toBe(false);
    expect(indexes.kitchenStationsById.size).toBe(1);
  });

  it('indexes actors in existing staff-before-customer lookup order by string ID', () => {
    const staff = { id: 1, label: 'staff' };
    const customer = { id: '1', label: 'customer' };
    const indexes = createRenderIndexes({ staff: [staff], customers: [customer] });

    expect(indexes.actorsByStringId.get('1')).toBe(staff);
  });
});
