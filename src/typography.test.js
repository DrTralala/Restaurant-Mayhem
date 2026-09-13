import { describe, expect, it } from 'vitest';
import {
  CANVAS_FONT_ROLES,
  FONT_FAMILY,
  TYPOGRAPHY,
  getCanvasFont,
  humaniseIdentifier,
  sentenceCase,
} from './typography';

describe('shared typography', () => {
  it('defines one UI family with a readable role hierarchy', () => {
    expect(TYPOGRAPHY.body.fontFamily).toBe(FONT_FAMILY);
    expect(TYPOGRAPHY.heading.fontFamily).toBe(FONT_FAMILY);
    expect(TYPOGRAPHY.control.fontFamily).toBe(FONT_FAMILY);
    expect(TYPOGRAPHY.secondary.fontFamily).toBe(FONT_FAMILY);
    expect(TYPOGRAPHY.heading.fontSize).toBeGreaterThan(TYPOGRAPHY.body.fontSize);
    expect(TYPOGRAPHY.body.fontSize).toBeGreaterThan(TYPOGRAPHY.secondary.fontSize);
    expect(TYPOGRAPHY.heading.fontWeight).toBeGreaterThan(TYPOGRAPHY.body.fontWeight);
    expect(TYPOGRAPHY.control.fontWeight).toBeGreaterThan(TYPOGRAPHY.body.fontWeight);
  });

  it('uses the same family for canvas text while keeping canvas roles compact', () => {
    for (const role of Object.keys(CANVAS_FONT_ROLES)) {
      expect(getCanvasFont(role)).toContain(FONT_FAMILY);
    }
    expect(getCanvasFont('label')).toBe(`500 10px ${FONT_FAMILY}`);
    expect(getCanvasFont('icon')).toBe(`600 14px ${FONT_FAMILY}`);
  });

  it('turns internal identifiers into sentence-case labels', () => {
    expect(humaniseIdentifier('cashierTable')).toBe('Cashier');
    expect(humaniseIdentifier('newDishSlot')).toBe('New dish slot');
    expect(humaniseIdentifier('automatic_dishwasher')).toBe('Automatic dishwasher');
    expect(humaniseIdentifier('unlockVIP')).toBe('Unlock VIP');
    expect(sentenceCase('Reach Day 10')).toBe('Reach day 10');
  });
});
