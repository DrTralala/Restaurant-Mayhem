export function createInitialState() {
  return {
    restaurant: {
      name: 'My Restaurant',
      funds: 500,
      reputation: 2.0,
      day: 1,
      gameTime: 0,
      totalServed: 0,
      openHour: 10,
      closeHour: 22,
    },
    tables: [
      { id: 't1', seats: 2, status: 'empty', x: 200, y: 200 },
      { id: 't2', seats: 2, status: 'empty', x: 350, y: 200 },
      { id: 't3', seats: 4, status: 'empty', x: 200, y: 350 },
      { id: 't4', seats: 4, status: 'empty', x: 350, y: 350 },
    ],
    kitchenStations: [
      { id: 'k1', equipmentId: null, x: 100, y: 120 },
      { id: 'k2', equipmentId: null, x: 200, y: 120 },
    ],
    kitchenQueue: [],
    customers: [],
    staff: [],
    dishes: [],
    equipment: [],
    upgrades: [],
    milestones: [],
    recipeSlots: 1,
    staffSlots: 1,
    completedCustomers: [],
    dailyHistory: [],
    notifications: [],
    speed: 1,
    paused: false,
  };
}
