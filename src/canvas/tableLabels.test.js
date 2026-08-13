import { describe, expect, it } from 'vitest';
import { getTableNumber } from './tableLabels';

describe('getTableNumber', () => {
  it('maps every internal dining-table ID to its visible number', () => {
    expect(getTableNumber('t1')).toBe(1);
    expect(getTableNumber('t2')).toBe(2);
    expect(getTableNumber('t4')).toBe(4);
  });
});
