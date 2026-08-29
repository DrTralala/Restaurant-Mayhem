import { EQUIPMENT } from '../data/equipment';
import { UPGRADES } from '../data/upgrades';
import { MILESTONES } from '../data/milestones';

export function createInitialState() {
  return {
    restaurant: {
      name: 'My Restaurant',
      funds: 600,
      dailyRevenue: 0,
      reputation: 2.0,
      day: 1,
      gameTime: 10 * 3600, // start at 10:00 AM
      totalServed: 0,
      openHour: 0,
      closeHour: 24,
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
      { id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 2 },
      { id: 'ch2', tableId: 't1', x: 210, y: 240, rotation: 0 },
      // t2 (2-seat)
      { id: 'ch3', tableId: 't2', x: 370, y: 180, rotation: 2 },
      { id: 'ch4', tableId: 't2', x: 370, y: 240, rotation: 0 },
      // t3 (4-seat)
      { id: 'ch5', tableId: 't3', x: 210, y: 340, rotation: 2 },
      { id: 'ch6', tableId: 't3', x: 210, y: 400, rotation: 0 },
      { id: 'ch7', tableId: 't3', x: 180, y: 370, rotation: 1 },
      { id: 'ch8', tableId: 't3', x: 240, y: 370, rotation: 3 },
      // t4 (4-seat)
      { id: 'ch9', tableId: 't4', x: 370, y: 340, rotation: 2 },
      { id: 'ch10', tableId: 't4', x: 370, y: 400, rotation: 0 },
      { id: 'ch11', tableId: 't4', x: 340, y: 370, rotation: 1 },
      { id: 'ch12', tableId: 't4', x: 400, y: 370, rotation: 3 },
    ],
    doors: [{ id: 'door1', y: 340 }],
    cashierStations: [{
      id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'starter-cashier-waiter',
    }],
    kitchenStations: [
      { id: 'k1', equipmentId: 'eq1', x: 100, y: 120 },
      { id: 'k2', equipmentId: null, x: 200, y: 120 },
    ],
    floorDirt: [],
    washStations: [{ id: 'wash1', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
    queue: [],              // customers waiting outside for a free table
    serviceItems: [],
    serviceTables: [
      { id: 'st1', x: 140, y: 120 },
    ],
    customers: [],
    staff: [
      {
        id: 'starter-cook',
        name: 'Marco',
        gender: 'male',
        role: 'cook',
        skill: 3,
        morale: 80,
        salary: 200,
        carryingServiceItemId: null,
      },
      {
        id: 'starter-waiter',
        name: 'Sofia',
        gender: 'female',
        role: 'waiter',
        skill: 3,
        morale: 80,
        salary: 150,
        carryingServiceItemId: null,
      },
      {
        id: 'starter-host',
        name: 'Luca',
        gender: 'male',
        role: 'waiter',
        skill: 2,
        morale: 80,
        salary: 150,
        carryingServiceItemId: null,
      },
      {
        id: 'starter-cashier-waiter',
        name: 'Elena',
        gender: 'female',
        role: 'waiter',
        skill: 2,
        morale: 80,
        salary: 150,
        carryingServiceItemId: null,
      },
      {
        id: 'starter-janitor', name: 'Mia', gender: 'female', role: 'janitor',
        skill: 2, morale: 80, salary: 120, carryingServiceItemId: null,
      },
    ],
    dishes: [
      {
        id: 'starter-toast',
        name: 'Toasted Bread',
        base: 'Bread',
        method: 'Toasted',
        price: 12,
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
    unlockedDrinkIds: ['water'],
    staffSlots: 7,
    completedCustomers: [],
    dailyHistory: [],
    notifications: [],
    speed: 1,
    paused: false,
    version: 5,
  };
}
