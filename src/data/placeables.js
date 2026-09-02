import { ITEM_PRICES } from './items';

export const PLACEABLES = {
  table: {
    type: 'table',
    label: 'Dining Table',
    price: ITEM_PRICES.table,
    width: 40,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  chair: {
    type: 'chair',
    label: 'Dining Chair',
    price: ITEM_PRICES.chair,
    width: 20,
    height: 20,
    grid: 10,
    rotatable: true,
  },
  door: {
    type: 'door',
    label: 'Additional Door',
    price: ITEM_PRICES.door,
    width: 6,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  serviceTable: {
    type: 'serviceTable',
    label: 'Service Counter',
    price: ITEM_PRICES.serviceTable,
    width: 120,
    height: 40,
    grid: 20,
    rotatable: true,
  },
  cashierTable: {
    type: 'cashierTable',
    label: 'Cashier Table',
    price: ITEM_PRICES.cashierTable,
    width: 80,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  kitchenStation: {
    type: 'kitchenStation',
    label: 'Kitchen Station',
    price: null,
    width: 40,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  manualSink: {
    type: 'manualSink',
    label: 'Sink',
    price: null,
    width: 40,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  equipmentStation: {
    type: 'equipmentStation',
    label: 'Equipment Station',
    price: null,
    width: 40,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  automaticDishwasher: {
    type: 'automaticDishwasher', label: 'Automatic Dishwasher',
    price: ITEM_PRICES.automaticDishwasher, width: 40, height: 40, grid: 20, rotatable: false,
  },
};

export function getPlaceable(itemType) {
  return Object.prototype.hasOwnProperty.call(PLACEABLES, itemType)
    ? PLACEABLES[itemType]
    : undefined;
}

export function getPlaceableDimensions(itemType, rotation = 0) {
  const item = getPlaceable(itemType);
  if (!item) return null;
  const normalisedRotation = Number.isInteger(rotation) ? ((rotation % 4) + 4) % 4 : 0;
  const quarterTurn = item.rotatable && normalisedRotation % 2 === 1;
  return {
    width: quarterTurn ? item.height : item.width,
    height: quarterTurn ? item.width : item.height,
  };
}
