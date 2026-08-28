import { describe, expect, it } from 'vitest';
import { getServiceItemEmoji } from './serviceItemEmoji';

describe('getServiceItemEmoji', () => {
  it.each([
    ['Bread', '🍞'], ['Pasta', '🍝'], ['Rice', '🍚'], ['Potato', '🥔'],
    ['Chicken', '🍗'], ['Beef', '🥩'], ['Fish', '🐟'], ['Vegetables', '🥗'],
    ['Eggs', '🍳'], ['Cheese', '🧀'],
  ])('maps dish base %s to %s', (base, emoji) => {
    expect(getServiceItemEmoji(
      { kind: 'dish', menuItemId: 'dish' },
      [{ id: 'dish', base }],
    )).toBe(emoji);
  });

  it.each([
    ['water', '💧'], ['tea', '🍵'], ['coffee', '☕'], ['juice', '🧃'], ['soda', '🥤'],
  ])('maps drink %s to %s', (menuItemId, emoji) => {
    expect(getServiceItemEmoji({ kind: 'drink', menuItemId }, [])).toBe(emoji);
  });

  it('uses safe fallbacks for deleted menu records', () => {
    expect(getServiceItemEmoji({ kind: 'dish', menuItemId: 'missing' }, [])).toBe('🍽️');
    expect(getServiceItemEmoji({ kind: 'drink', menuItemId: 'missing' }, [])).toBe('🥤');
  });
});
