import { ITEM_PRICES } from './items';

export const PLACEABLES = {
  table: {
    type: 'table',
    label: 'Dining table',
    price: ITEM_PRICES.table,
    width: 40,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  chair: {
    type: 'chair',
    label: 'Dining chair',
    price: ITEM_PRICES.chair,
    width: 20,
    height: 20,
    grid: 10,
    rotatable: true,
  },
  door: {
    type: 'door',
    label: 'Additional door',
    price: ITEM_PRICES.door,
    width: 6,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  serviceTable: {
    type: 'serviceTable',
    label: 'Service counter',
    price: ITEM_PRICES.serviceTable,
    width: 120,
    height: 40,
    grid: 20,
    rotatable: true,
  },
  cashierTable: {
    type: 'cashierTable',
    label: 'Cashier',
    price: ITEM_PRICES.cashierTable,
    width: 80,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  kitchenStation: {
    type: 'kitchenStation',
    label: 'Kitchen station',
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
    label: 'Equipment station',
    price: null,
    width: 40,
    height: 40,
    grid: 20,
    rotatable: false,
  },
  automaticDishwasher: {
    type: 'automaticDishwasher', label: 'Automatic dishwasher',
    price: ITEM_PRICES.automaticDishwasher, width: 40, height: 40, grid: 20, rotatable: false,
  },
  couch: {
    type: 'couch',
    label: 'Couch',
    price: 400,
    width: 40,
    height: 20,
    grid: 20,
    rotatable: true,
    staffAmenity: true,
    capacity: 2,
    sessionSeconds: 900,
    moralePerHour: 6,
  },
  arcade: {
    type: 'arcade',
    label: 'Arcade',
    price: 800,
    width: 20,
    height: 20,
    grid: 20,
    rotatable: true,
    staffAmenity: true,
    capacity: 1,
    sessionSeconds: 600,
    moralePerHour: 8,
  },
  bed: {
    type: 'bed',
    label: 'Bed',
    price: 500,
    width: 20,
    height: 40,
    grid: 20,
    rotatable: true,
    staffAmenity: true,
    capacity: 1,
    minimumSleepSeconds: 25200,
    fullMorale: true,
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
