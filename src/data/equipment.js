export const EQUIPMENT = [
  { id: 'eq1', name: 'Toaster', type: 'toaster', level: 1, purchaseCost: 200, upgradeCosts: [100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600], speedMultiplier: 1.0, qualityBonus: 0, owned: false },
  { id: 'eq2', name: 'Oven', type: 'oven', level: 1, purchaseCost: 500, upgradeCosts: [250, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000], speedMultiplier: 1.0, qualityBonus: 0, owned: false },
  { id: 'eq3', name: 'Fryer', type: 'fryer', level: 1, purchaseCost: 400, upgradeCosts: [200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200], speedMultiplier: 1.0, qualityBonus: 0, owned: false },
  { id: 'eq4', name: 'Blender', type: 'blender', level: 1, purchaseCost: 300, upgradeCosts: [150, 300, 600, 1200, 2400, 4800, 9600, 19200, 38400], speedMultiplier: 1.0, qualityBonus: 0, owned: false },
  { id: 'eq5', name: 'Coffee Machine', type: 'coffee_machine', level: 1, purchaseCost: 350, upgradeCosts: [175, 350, 700, 1400, 2800, 5600, 11200, 22400, 44800], speedMultiplier: 1.0, qualityBonus: 0, owned: false },
];

export function getEquipmentLevelMultipliers(level) {
  return {
    speedMultiplier: 1 - (level - 1) * 0.05,
    qualityBonus: (level - 1) * 0.05,
  };
}
