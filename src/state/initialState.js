import { EQUIPMENT } from '../data/equipment';
import { UPGRADES } from '../data/upgrades';
import { MILESTONES } from '../data/milestones';

export function createInitialState() {
  return {
    restaurant: {
      name: 'My Restaurant',
      funds: 500,
      reputation: 2.0,
      day: 1,
      gameTime: 10 * 3600, // start at 10:00 AM
      totalServed: 0,
      openHour: 10,
      closeHour: 22,
      expansionLevel: 1,
    },
    tables: [
      { id: 't1', seats: 2, status: 'empty', x: 200, y: 200 },
      { id: 't2', seats: 2, status: 'empty', x: 360, y: 200 },
      { id: 't3', seats: 4, status: 'empty', x: 200, y: 360 },
      { id: 't4', seats: 4, status: 'empty', x: 360, y: 360 },
    ],
    chairs: [
      // t1 (2-seat)
      { id: 'ch1', tableId: 't1', x: 210, y: 180 },
      { id: 'ch2', tableId: 't1', x: 210, y: 240 },
      // t2 (2-seat)
      { id: 'ch3', tableId: 't2', x: 370, y: 180 },
      { id: 'ch4', tableId: 't2', x: 370, y: 240 },
      // t3 (4-seat)
      { id: 'ch5', tableId: 't3', x: 210, y: 340 },
      { id: 'ch6', tableId: 't3', x: 210, y: 400 },
      { id: 'ch7', tableId: 't3', x: 180, y: 370 },
      { id: 'ch8', tableId: 't3', x: 240, y: 370 },
      // t4 (4-seat)
      { id: 'ch9', tableId: 't4', x: 370, y: 340 },
      { id: 'ch10', tableId: 't4', x: 370, y: 400 },
      { id: 'ch11', tableId: 't4', x: 340, y: 370 },
      { id: 'ch12', tableId: 't4', x: 400, y: 370 },
    ],
    kitchenStations: [
      { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
      { id: 'k2', equipmentId: null, x: 200, y: 120 },
    ],
    kitchenQueue: [],
    queue: [],              // customers waiting outside for a free table
    customers: [],
    staff: [
      {
        id: 'starter-cook',
        name: 'Marco',
        role: 'cook',
        skill: 3,
        morale: 80,
        salary: 200,
      },
      {
        id: 'starter-waiter',
        name: 'Anna',
        role: 'waiter',
        skill: 3,
        morale: 80,
        salary: 150,
      },
      {
        id: 'starter-host',
        name: 'Luca',
        role: 'host',
        skill: 2,
        morale: 80,
        salary: 150,
      },
    ],
    dishes: [
      {
        id: 'starter-toast',
        name: 'Toasted Bread',
        base: 'Bread',
        method: 'Toasted',
        price: 8,
        prepTime: 60,
        quality: 1,
        popularity: 50,
        cuisine: 'generic',
        requiredEquipmentId: 'eq1',
        unlocked: true,
      },
    ],
    equipment: EQUIPMENT.map(e =>
      e.id === 'eq1' ? { ...e, owned: true } : e
    ),
    upgrades: UPGRADES,
    milestones: MILESTONES,
    recipeSlots: 1,
    staffSlots: 3,
    completedCustomers: [],
    dailyHistory: [],
    notifications: [],
    speed: 1,
    paused: false,
    version: 2,
  };
}
