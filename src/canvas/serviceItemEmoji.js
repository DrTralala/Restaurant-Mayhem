const DISH_EMOJI = Object.freeze({
  Bread: '🍞', Pasta: '🍝', Rice: '🍚', Potato: '🥔', Chicken: '🍗',
  Beef: '🥩', Fish: '🐟', Vegetables: '🥗', Eggs: '🍳', Cheese: '🧀',
});

const DRINK_EMOJI = Object.freeze({
  water: '💧', tea: '🍵', coffee: '☕', juice: '🧃', soda: '🥤',
});

export function getServiceItemEmoji(item, dishes = []) {
  if (item?.kind === 'drink') return DRINK_EMOJI[item.menuItemId] || '🥤';
  const dish = Array.isArray(dishes)
    ? dishes.find(candidate => candidate.id === item?.menuItemId)
    : null;
  return DISH_EMOJI[dish?.base] || '🍽️';
}
