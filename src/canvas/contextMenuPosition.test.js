import { describe, expect, it } from 'vitest';
import { getContextMenuPosition } from './contextMenuPosition';

describe('getContextMenuPosition', () => {
  it('offsets a top-left anchor by eight pixels', () => {
    expect(getContextMenuPosition(
      { x: 0, y: 0 },
      { width: 320, height: 700 },
      { width: 180, height: 120 },
    )).toEqual({ x: 8, y: 8 });
  });

  it('clamps a lower-right anchor independently on each axis', () => {
    expect(getContextMenuPosition(
      { x: 310, y: 690 },
      { width: 320, height: 700 },
      { width: 180, height: 120 },
    )).toEqual({ x: 140, y: 580 });
  });

  it('pins a panel larger than the wrapper to the origin', () => {
    expect(getContextMenuPosition(
      { x: 100, y: 100 },
      { width: 120, height: 90 },
      { width: 200, height: 150 },
    )).toEqual({ x: 0, y: 0 });
  });

  it('uses the unclamped offset for non-finite or negative measured sizes', () => {
    expect(getContextMenuPosition(
      { x: 30, y: 40 },
      { width: 100, height: Number.NaN },
      { width: 40, height: 30 },
    )).toEqual({ x: 38, y: 48 });

    expect(getContextMenuPosition(
      { x: 30, y: 40 },
      { width: -1, height: 100 },
      { width: 40, height: 30 },
    )).toEqual({ x: 38, y: 48 });
  });
});
