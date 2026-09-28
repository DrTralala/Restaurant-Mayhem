import { describe, expect, it } from 'vitest';
import { getServiceItemEmoji } from './serviceItemEmoji';
import { createRenderIndexes } from './renderIndexes';

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

  it('renders dirty food as a dish and dirty drinks as empty cups', () => {
    for (const state of ['dirty_at_table', 'carried_dirty', 'queued_for_wash', 'washing']) {
      expect(getServiceItemEmoji({ kind: 'dish', state }, [])).toBe('🍽️');
      expect(getServiceItemEmoji({ kind: 'drink', state }, [])).toBe('🥛');
    }
  });

  it('uses the supplied first-match strict dish index', () => {
    const dishes = [
      { id: 1, base: 'Bread' },
      { id: 1, base: 'Pasta' },
      { id: '1', base: 'Rice' },
      { id: NaN, base: 'Fish' },
    ];
    const indexes = createRenderIndexes({ dishes });

    expect(getServiceItemEmoji({ kind: 'dish', menuItemId: 1 }, dishes, indexes.dishesById)).toBe('🍞');
    expect(getServiceItemEmoji({ kind: 'dish', menuItemId: '1' }, dishes, indexes.dishesById)).toBe('🍚');
    expect(getServiceItemEmoji({ kind: 'dish', menuItemId: NaN }, dishes, indexes.dishesById)).toBe('🍽️');
  });
});
