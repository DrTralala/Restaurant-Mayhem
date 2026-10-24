import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRevenueChart } from './revenueChart';

const WIDTH = 300;
const HEIGHT = 120;
const PLOT_HEIGHT = HEIGHT - 20;

function historyFor(revenues) {
  return revenues.map((revenue, index) => ({ day: index + 1, revenue }));
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getRevenueChart', () => {
  it('returns null for missing, nonfinite or nonpositive dimensions', () => {
    const invalidDimensions = [
      [Number.NaN, HEIGHT],
      [Number.POSITIVE_INFINITY, HEIGHT],
      [Number.NEGATIVE_INFINITY, HEIGHT],
      [0, HEIGHT],
      [-1, HEIGHT],
      [WIDTH, Number.NaN],
      [WIDTH, Number.POSITIVE_INFINITY],
      [WIDTH, Number.NEGATIVE_INFINITY],
      [WIDTH, 0],
      [WIDTH, -1],
      [undefined, HEIGHT],
      [WIDTH, undefined],
    ];

    for (const [width, height] of invalidDimensions) {
      expect(getRevenueChart(historyFor([100]), width, height)).toBeNull();
    }
    expect(getRevenueChart(historyFor([100]))).toBeNull();
    expect(getRevenueChart(historyFor([100]), WIDTH)).toBeNull();
  });

  it('lays out mixed-sign revenue around a truthful baseline in stored order', () => {
    const chart = getRevenueChart(historyFor([100, -50, 0, null, Infinity]), WIDTH, HEIGHT);

    expect(chart.baselineY).toBeCloseTo(66.6667, 4);
    expect(chart.bars).toHaveLength(5);
    expect(chart.bars.map(bar => bar.dayLabel))
      .toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    expect(chart.bars.map(bar => bar.value)).toEqual([100, -50, 0, null, null]);
    expect(chart.bars.map(bar => bar.x)).toEqual([2, 62, 122, 182, 242]);
    expect(chart.bars.every(bar => bar.width === 56)).toBe(true);
    expect(Object.keys(chart.bars[0]).sort())
      .toEqual(['dayLabel', 'height', 'value', 'width', 'x', 'y']);

    const [positive, negative, zero, missing, nonfinite] = chart.bars;
    expect(positive.y).toBeCloseTo(0, 10);
    expect(positive.height).toBeCloseTo(chart.baselineY, 10);
    expect(positive.y + positive.height).toBeCloseTo(chart.baselineY, 10);

    expect(negative.y).toBeCloseTo(chart.baselineY, 10);
    expect(negative.height).toBeCloseTo(PLOT_HEIGHT - chart.baselineY, 10);
    expect(negative.y + negative.height).toBeCloseTo(PLOT_HEIGHT, 10);

    expect(zero.y).toBeCloseTo(chart.baselineY, 10);
    expect(zero.height).toBe(0);
    expect(missing.y).toBeCloseTo(chart.baselineY, 10);
    expect(missing.height).toBe(0);
    expect(nonfinite.y).toBeCloseTo(chart.baselineY, 10);
    expect(nonfinite.height).toBe(0);
  });

  it('anchors the baseline at zero for all-negative revenue and at the bottom for all-positive revenue', () => {
    const negative = getRevenueChart(historyFor([-40, -10]), WIDTH, HEIGHT);
    expect(negative.baselineY).toBe(0);
    expect(negative.bars[0].y).toBe(0);
    expect(negative.bars[0].height).toBeCloseTo(PLOT_HEIGHT, 10);
    expect(negative.bars[1].y).toBe(0);
    expect(negative.bars[1].height).toBeCloseTo(PLOT_HEIGHT / 4, 10);

    const positive = getRevenueChart(historyFor([10, 40]), WIDTH, HEIGHT);
    expect(positive.baselineY).toBe(PLOT_HEIGHT);
    expect(positive.bars[0].y).toBeCloseTo(PLOT_HEIGHT * 0.75, 10);
    expect(positive.bars[0].height).toBeCloseTo(PLOT_HEIGHT / 4, 10);
    expect(positive.bars[1].y).toBe(0);
    expect(positive.bars[1].height).toBeCloseTo(PLOT_HEIGHT, 10);
  });

  it('does not let invalid revenue poison the finite scale', () => {
    const clean = getRevenueChart([
      { day: 1, revenue: 10 },
      { day: 2, revenue: -5 },
    ], WIDTH, HEIGHT);
    const withInvalid = getRevenueChart([
      { day: 1, revenue: 10 },
      { day: 2, revenue: -5 },
      { day: 3, revenue: Number.POSITIVE_INFINITY },
      { day: 4, revenue: Number.NEGATIVE_INFINITY },
      { day: 5, revenue: Number.NaN },
      { day: 6, revenue: null },
    ], WIDTH, HEIGHT);

    expect(withInvalid.baselineY).toBe(clean.baselineY);
    expect(withInvalid.baselineY).toBeCloseTo(PLOT_HEIGHT * 2 / 3, 10);
    expect(withInvalid.bars[0].height).toBeCloseTo(clean.bars[0].height, 10);
    expect(withInvalid.bars[1].height).toBeCloseTo(clean.bars[1].height, 10);
    for (const bar of withInvalid.bars.slice(2)) {
      expect(bar.value).toBeNull();
      expect(bar.height).toBe(0);
    }
  });

  it('keeps geometry finite for extreme finite revenue', () => {
    const chart = getRevenueChart(historyFor([
      Number.MAX_VALUE,
      -Number.MAX_VALUE,
      1e308,
      -1e308,
    ]), WIDTH, HEIGHT);

    expect(chart.baselineY).toBeCloseTo(PLOT_HEIGHT / 2, 10);
    expect(chart.bars).toHaveLength(4);
    for (const bar of chart.bars) {
      expect(Number.isFinite(bar.value)).toBe(true);
      expect(Number.isFinite(bar.x)).toBe(true);
      expect(Number.isFinite(bar.y)).toBe(true);
      expect(Number.isFinite(bar.width)).toBe(true);
      expect(Number.isFinite(bar.height)).toBe(true);
      expect(bar.width).toBeGreaterThanOrEqual(0);
      expect(bar.height).toBeGreaterThanOrEqual(0);
    }
    expect(chart.bars[0].height).toBeCloseTo(PLOT_HEIGHT / 2, 10);
    expect(chart.bars[1].height).toBeCloseTo(PLOT_HEIGHT / 2, 10);

    const tiny = getRevenueChart(
      historyFor([Number.MIN_VALUE, -Number.MIN_VALUE]),
      WIDTH,
      HEIGHT,
    );
    expect(tiny.baselineY).toBeCloseTo(PLOT_HEIGHT / 2, 10);
    expect(tiny.bars[0].height).toBeCloseTo(PLOT_HEIGHT / 2, 10);
    expect(tiny.bars[1].height).toBeCloseTo(PLOT_HEIGHT / 2, 10);
  });

  it('keeps zero-value bars flat when all other valid revenue shares one sign', () => {
    const negative = getRevenueChart(historyFor([-40, 0]), WIDTH, HEIGHT);
    expect(negative.baselineY).toBe(0);
    expect(negative.bars[1].height).toBe(0);
    expect(negative.bars[1].y).toBe(0);

    const positive = getRevenueChart(historyFor([0, 40]), WIDTH, HEIGHT);
    expect(positive.baselineY).toBe(PLOT_HEIGHT);
    expect(positive.bars[0].height).toBe(0);
    expect(positive.bars[0].y).toBe(PLOT_HEIGHT);
  });

  it('uses only the latest seven stored entries without sorting or mutation', () => {
    const history = freeze(Array.from({ length: 9 }, (_, index) => ({
      day: index + 1,
      revenue: index + 1,
    })));
    const snapshot = JSON.stringify(history);
    const random = vi.spyOn(Math, 'random');

    const chart = getRevenueChart(history, WIDTH, HEIGHT);

    expect(chart.bars.map(bar => bar.dayLabel))
      .toEqual(['D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']);
    expect(chart.bars.map(bar => bar.value)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(JSON.stringify(history)).toBe(snapshot);
    expect(history.map(record => record.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(random).not.toHaveBeenCalled();
  });

  it('treats missing or nonarray history as empty', () => {
    for (const history of [undefined, null, {}, 'history', 42, true]) {
      expect(getRevenueChart(history, WIDTH, HEIGHT))
        .toEqual({ baselineY: PLOT_HEIGHT, bars: [] });
    }
    expect(getRevenueChart([], WIDTH, HEIGHT))
      .toEqual({ baselineY: PLOT_HEIGHT, bars: [] });
  });

  it('uses a positive max of one and negative min of zero when every value is zero or unavailable', () => {
    const zero = getRevenueChart(historyFor([0, 0, 0]), WIDTH, HEIGHT);
    expect(zero.baselineY).toBe(PLOT_HEIGHT);
    expect(zero.bars.map(bar => bar.value)).toEqual([0, 0, 0]);
    expect(zero.bars.map(bar => bar.height)).toEqual([0, 0, 0]);

    const unavailable = getRevenueChart([
      { day: 1, revenue: null },
      { day: Number.NaN, revenue: Number.NaN },
      { day: 3, revenue: Number.POSITIVE_INFINITY },
      null,
    ], WIDTH, HEIGHT);
    expect(unavailable.baselineY).toBe(PLOT_HEIGHT);
    expect(unavailable.bars.map(bar => bar.value)).toEqual([null, null, null, null]);
    expect(unavailable.bars.map(bar => bar.height)).toEqual([0, 0, 0, 0]);
    expect(unavailable.bars.map(bar => bar.dayLabel)).toEqual(['D1', 'D?', 'D3', 'D?']);
  });

  it('clamps plot, bar and label geometry at extreme dimensions', () => {
    const short = getRevenueChart(historyFor([100, -50]), WIDTH, 20);
    expect(short.baselineY).toBe(0);
    expect(short.bars.map(bar => bar.height)).toEqual([0, 0]);

    const narrow = getRevenueChart(historyFor([1, 2, 3, 4, 5]), 2, HEIGHT);
    expect(narrow.bars.every(bar => bar.width === 0)).toBe(true);
    expect(narrow.bars.map(bar => bar.x)).toEqual([2, 2.4, 2.8, 3.2, 3.6]);
    expect(narrow.bars.every(bar => Number.isFinite(bar.y))).toBe(true);
  });

  it('labels finite days with their stored value and everything else with D?', () => {
    const chart = getRevenueChart([
      { day: 0, revenue: 1 },
      { day: -2, revenue: 2 },
      { day: 2.5, revenue: 3 },
      { day: '4', revenue: 4 },
      { day: Number.NaN, revenue: 5 },
      { revenue: 6 },
    ], WIDTH, HEIGHT);

    expect(chart.bars.map(bar => bar.dayLabel))
      .toEqual(['D0', 'D-2', 'D2.5', 'D?', 'D?', 'D?']);
  });
});
