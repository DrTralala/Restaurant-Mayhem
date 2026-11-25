import { describe, expect, it } from 'vitest';
import { getPartySizeFit, physicalTableCapacity } from './tableFit';

describe('physical table capacity', () => {
  const table = { id: 'a', x: 1, y: 1, seats: 2 };
  const chair = (id, tableId = 'a', x = 1, y = 1) => ({ id, tableId, x, y });

  it('caps physical seats at the table rating', () => {
    expect(physicalTableCapacity(table, [
      chair('one'), chair('two'), chair('three'), chair('other', 'b'),
    ])).toBe(2);
  });

  it('uses one placed associated chair when only one is present', () => {
    expect(physicalTableCapacity(table, [chair('one')])).toBe(1);
  });

  it('returns zero when the table has no placement coordinates', () => {
    expect(physicalTableCapacity({ ...table, x: undefined }, [chair('one'), chair('two')])).toBe(0);
  });

  it('counts placed chairs when the table has no seat rating', () => {
    expect(physicalTableCapacity({ id: 'a', x: 1, y: 1 }, [chair('one'), chair('two')])).toBe(2);
  });

  it('does not count associated chairs without placement coordinates', () => {
    expect(physicalTableCapacity(table, [chair('one'), chair('two', 'a', Number.NaN, 1)])).toBe(1);
  });
});

describe('party size fit', () => {
  const table = (id, seats, minPartySize, status = 'empty') => ({
    id, x: 1, y: 1, seats, minPartySize, status,
  });
  const chairs = (tableId, count) => Array.from({ length: count }, (_, index) => ({
    id: `${tableId}-chair-${index}`, tableId, x: index + 1, y: 1,
  }));

  it('reports no-fit when no placed table has enough physical capacity', () => {
    const state = {
      tables: [table('two-top', 2)],
      chairs: chairs('two-top', 2),
    };

    expect(getPartySizeFit(state, 3)).toBe('no-fit');
  });

  it('reports below-minimum only when every physically fitting table excludes the party', () => {
    const state = {
      tables: [table('four-top', 4, 3), table('two-top', 2, 3), table('one-top', 1)],
      chairs: [
        ...chairs('four-top', 4),
        ...chairs('two-top', 2),
        ...chairs('one-top', 1),
      ],
    };

    expect(getPartySizeFit(state, 2)).toBe('below-minimum');
  });

  it('allows a static fit without claiming availability for an occupied table', () => {
    const state = {
      tables: [table('occupied-four-top', 4, 2, 'occupied')],
      chairs: chairs('occupied-four-top', 4),
    };

    expect(getPartySizeFit(state, 2)).toBe('allowed');
  });
});
