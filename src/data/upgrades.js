export const UPGRADES = [
  { id: 'u1', name: 'Extra Table', category: 'dining', description: 'Add 4 more seats', level: 0, costs: [300, 600, 1200, 2400], effects: { type: 'table', value: 1 } },
  { id: 'u2', name: 'Comfortable Chairs', category: 'dining', description: 'Customers stay longer, tip more', level: 0, costs: [200, 400, 800, 1600], effects: { type: 'tipBonus', value: 0.05 } },
  { id: 'u3', name: 'Faster Oven', category: 'kitchen', description: 'All cooking 10% faster', level: 0, costs: [400, 800, 1600, 3200], effects: { type: 'globalSpeed', value: 0.10 } },
  { id: 'u4', name: 'Better Knives', category: 'kitchen', description: 'Dish quality +5%', level: 0, costs: [350, 700, 1400, 2800], effects: { type: 'qualityBonus', value: 0.05 } },
  { id: 'u5', name: 'Marketing Campaign', category: 'marketing', description: 'More customers arrive', level: 0, costs: [500, 1000, 2000, 4000], effects: { type: 'customerRate', value: 0.02 } },
  { id: 'u6', name: 'Social Media', category: 'marketing', description: 'Better reputation gain', level: 0, costs: [300, 600, 1200, 2400], effects: { type: 'reputationGain', value: 0.01 } },
  { id: 'u7', name: 'Wall Art', category: 'decor', description: 'Slight reputation boost', level: 0, costs: [150, 300, 600, 1200], effects: { type: 'reputation', value: 0.1 } },
  { id: 'u8', name: 'Ambient Lighting', category: 'decor', description: 'Happier customers', level: 0, costs: [250, 500, 1000, 2000], effects: { type: 'happiness', value: 5 } },
];
