import { describe, expect, it, vi } from 'vitest';
import { buildPaymentReceipt } from './paymentReceipt';

describe('buildPaymentReceipt', () => {
  it('rounds only the fractional tip and preserves the exact subtotal-plus-tip sum and keys', () => {
    const receipt = buildPaymentReceipt({
      customer: { id: 'c1', dishId: null, drinkId: undefined },
      subtotal: 12.345,
      day: 1,
      gameTime: 0,
      tipRate: 0.2,
      reviewScore: 80,
    });

    expect(Object.keys(receipt)).toEqual([
      'customerId', 'day', 'dishId', 'drinkId', 'revenue', 'tip', 'totalPaid', 'reviewScore',
    ]);
    expect(receipt).toEqual({
      customerId: 'c1', day: 1, dishId: null, drinkId: undefined,
      revenue: 12.345 + 2.47, tip: 2.47, totalPaid: 12.345 + 2.47, reviewScore: 80,
    });
  });

  it.each([
    ['explicit day', { day: 9 }, 9],
    ['zero day', { day: 0 }, 2],
    ['missing day', {}, 2],
  ])('uses the explicit-day or truthy fallback for %s at midnight', (_label, dayFields, expectedDay) => {
    const receipt = buildPaymentReceipt({
      customer: { id: 'c1', dishId: 'dish', drinkId: 'drink' },
      subtotal: 0,
      gameTime: 86400,
      tipRate: 0.2,
      reviewScore: 80,
      ...dayFields,
    });

    expect(receipt.day).toBe(expectedDay);
  });

  it('preserves zero totals and null/undefined line IDs with frozen inputs and fresh results', () => {
    const input = Object.freeze({
      customer: Object.freeze({ id: 'free', dishId: undefined, drinkId: null }),
      subtotal: 0,
      day: 1,
      gameTime: 0,
      tipRate: 0.2,
      reviewScore: 80,
    });

    const first = buildPaymentReceipt(input);
    const second = buildPaymentReceipt(input);

    expect(first).toEqual({
      customerId: 'free', day: 1, dishId: undefined, drinkId: null,
      revenue: 0, tip: 0, totalPaid: 0, reviewScore: 80,
    });
    expect(first).not.toBe(second);
  });

  it('does not draw randomness', () => {
    const random = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('receipt construction must not draw randomness');
    });

    expect(() => buildPaymentReceipt({
      customer: { id: 'c1', dishId: null, drinkId: null },
      subtotal: 12,
      day: 1,
      gameTime: 36000,
      tipRate: 0.2,
      reviewScore: 80,
    })).not.toThrow();
    expect(random).not.toHaveBeenCalled();
  });
});
