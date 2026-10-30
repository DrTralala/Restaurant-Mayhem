import { describe, expect, it } from 'vitest';
import { getTableLocatePoint } from './tableLocatePoint';

describe('getTableLocatePoint', () => {
  it('resolves a unique numeric/string identity to the centre without mutating tables', () => {
    const tables = Object.freeze([Object.freeze({ id: 0, x: 100, y: 60 })]);
    expect(getTableLocatePoint(tables, '0')).toEqual({ x: 120, y: 80 });
    expect(tables[0]).toEqual({ id: 0, x: 100, y: 60 });
  });

  it.each([null, undefined, '', '  ', {}, false, -1, 0.5, NaN, Infinity])(
    'rejects invalid requested identity %s', id => {
      expect(getTableLocatePoint([{ id, x: 100, y: 60 }], id)).toBeNull();
    },
  );

  it.each([
    undefined, [], [null], [{ id: 'other', x: 100, y: 60 }],
    [{ id: 0, x: 100, y: 60 }, { id: '0', x: 200, y: 80 }],
    [{ id: 0, x: NaN, y: 60 }], [{ id: 0, x: 100, y: Infinity }],
    [{ id: 0, x: '100', y: 60 }],
  ])('rejects missing, ambiguous or malformed tables %j', tables => {
    expect(getTableLocatePoint(tables, 0)).toBeNull();
  });
});
