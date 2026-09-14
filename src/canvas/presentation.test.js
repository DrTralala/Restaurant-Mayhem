import { describe, expect, it, vi } from 'vitest';
import {
  drawCustomerLayer,
  drawFurnitureLayer,
  drawObjectLabel,
  drawPlacementPreview,
  drawSelectionLayer,
  drawStaffLayer,
} from './layers';
import { findClickedEntity } from './interaction';
import { selectFurnitureInRect } from './selection';
import { interpolateSimulationState } from './interpolation';
import { getAmenityGeometry } from '../data/staffAmenities';

function makeContext() {
  const calls = {
    fills: [],
    rects: [],
    texts: [],
    arcs: [],
    lines: [],
    rotations: [],
    saves: 0,
    restores: 0,
  };
  const stack = [];
  let textAlign = 'start';
  let textBaseline = 'alphabetic';
  let fillStyle = '';
  let strokeStyle = '';
  let font = '';
  let lineWidth = 1;
  let alpha = 1;
  let offsetX = 0;
  let offsetY = 0;
  let figureScale = 1;
  const point = (x, y) => ({
    x: offsetX + x * figureScale,
    y: offsetY + y * figureScale,
  });

  const ctx = {
    canvas: { width: 1000, height: 700 },
    get fillStyle() { return fillStyle; },
    set fillStyle(value) { fillStyle = value; },
    get strokeStyle() { return strokeStyle; },
    set strokeStyle(value) { strokeStyle = value; },
    get font() { return font; },
    set font(value) { font = value; },
    get lineWidth() { return lineWidth; },
    set lineWidth(value) { lineWidth = value; },
    get globalAlpha() { return alpha; },
    set globalAlpha(value) { alpha = value; },
    get textAlign() { return textAlign; },
    set textAlign(value) { textAlign = value; },
    get textBaseline() { return textBaseline; },
    set textBaseline(value) { textBaseline = value; },
    save() {
      calls.saves += 1;
      stack.push({ textAlign, textBaseline, fillStyle, strokeStyle, font, lineWidth, alpha,
        offsetX, offsetY, figureScale });
    },
    restore() {
      calls.restores += 1;
      const prior = stack.pop();
      if (!prior) return;
      ({ textAlign, textBaseline, fillStyle, strokeStyle, font, lineWidth, alpha,
        offsetX, offsetY, figureScale } = prior);
    },
    translate: (x, y) => { offsetX += x * figureScale; offsetY += y * figureScale; },
    scale: (x, y) => { figureScale *= x; },
    rotate: radians => calls.rotations.push(radians),
    beginPath: () => {},
    moveTo: (x, y) => calls.lines.push(point(x, y)),
    lineTo: (x, y) => calls.lines.push(point(x, y)),
    stroke: () => {},
    arc: (x, y, radius) => calls.arcs.push({ ...point(x, y), radius, fillStyle, strokeStyle, alpha }),
    fill: () => {},
    fillRect: (x, y, w, h) => calls.rects.push({ ...point(x, y), w: w * figureScale, h: h * figureScale, fillStyle }),
    strokeRect: (x, y, w, h) => calls.fills.push({ ...point(x, y), w: w * figureScale, h: h * figureScale, strokeStyle }),
    measureText: text => ({ width: String(text).length * 5 }),
    fillText: (text, x, y) => calls.texts.push({
      text, ...point(x, y), font, fillStyle, textAlign, textBaseline, alpha,
    }),
  };
  ctx._calls = calls;
  return ctx;
}

const camera = { x: 0, y: 0, zoom: 1 };

function baseState(overrides = {}) {
  return {
    restaurant: { expansionLevel: 1, gameTime: 0, funds: 10_000 },
    tables: [],
    chairs: [],
    doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    serviceTables: [],
    cashierStations: [],
    kitchenStations: [],
    washStations: [],
    staffAmenities: [],
    staff: [],
    customers: [],
    queue: [],
    serviceItems: [],
    dishes: [],
    equipment: [],
    ...overrides,
  };
}

describe('canvas object labels', () => {
  it('uses the existing 9px font, centred wrapping, contrast, and save/restore', () => {
    const ctx = makeContext();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    drawObjectLabel(ctx, 'Kitchen station', { x: 100, y: 100, w: 40, h: 40 });

    expect(ctx._calls.saves).toBe(1);
    expect(ctx._calls.restores).toBe(1);
    expect(ctx._calls.texts.map(call => call.text)).toEqual(['Kitchen', 'station']);
    expect(ctx._calls.texts.every(call => call.font.includes('9px'))).toBe(true);
    expect(ctx._calls.texts.every(call => call.textAlign === 'center')).toBe(true);
    expect(ctx._calls.texts.every(call => call.textBaseline === 'middle')).toBe(true);
    expect(ctx._calls.texts.every(call => call.fillStyle === '#fff')).toBe(true);
    expect(ctx._calls.rects.some(rect => String(rect.fillStyle).includes('rgba(0,0,0'))).toBe(true);
    expect(ctx.textAlign).toBe('left');
    expect(ctx.textBaseline).toBe('alphabetic');
  });
});

describe('canvas fixture presentation', () => {
  it('renders normal staff amenities once with rotated footprints and readable labels', () => {
    const ctx = makeContext();
    const state = baseState({
      staffAmenities: [
        { id: 'couch', type: 'couch', x: 100, y: 200, rotation: 1, slots: [] },
        { id: 'arcade', type: 'arcade', x: 180, y: 200, rotation: 2, slots: [] },
        { id: 'bed', type: 'bed', x: 240, y: 200, rotation: 3, slots: [] },
      ],
    });

    drawFurnitureLayer(ctx, state, camera);

    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ x: 100, y: 200, w: 20, h: 40 }));
    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ x: 180, y: 200, w: 20, h: 20 }));
    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ x: 240, y: 200, w: 40, h: 20 }));
    expect(ctx._calls.texts.map(call => call.text)).toEqual(expect.arrayContaining(['Couch', 'Arcade', 'Bed']));
    expect(ctx._calls.texts.filter(call => ['Couch', 'Arcade', 'Bed'].includes(call.text)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ x: 110, y: 220 }),
        expect.objectContaining({ x: 190, y: 210 }),
        expect.objectContaining({ x: 260, y: 210 }),
      ]));
  });

  it('uses wrapped nine-pixel labels for kitchen stations and dishwashers without shrinking', () => {
    const ctx = makeContext();
    const state = baseState({
      kitchenStations: [{ id: 'k1', x: 100, y: 100, equipmentId: null }],
      washStations: [{ id: 'w1', type: 'automatic', level: 1, x: 160, y: 100, w: 40, h: 40 }],
    });

    drawFurnitureLayer(ctx, state, camera);

    expect(ctx._calls.texts.map(call => call.text)).toEqual(expect.arrayContaining([
      'Kitchen', 'station', 'Dish', 'washer',
    ]));
    const objectText = ctx._calls.texts.filter(call => ['Kitchen', 'station', 'Dish', 'washer'].includes(call.text));
    expect(objectText.every(call => call.font.includes('9px'))).toBe(true);
    expect(objectText.every(call => call.font.includes('5px') === false)).toBe(true);
  });

  it('renders rotated amenity placement previews through the shared label path', () => {
    const ctx = makeContext();
    drawPlacementPreview(ctx, baseState(), camera, {
      itemType: 'couch', x: 300, y: 200, rotation: 1, valid: true,
    });
    drawPlacementPreview(ctx, baseState(), camera, {
      itemType: 'automaticDishwasher', x: 340, y: 200, rotation: 0, valid: true,
    });

    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ x: 300, y: 200, w: 20, h: 40 }));
    expect(ctx._calls.texts.map(call => call.text)).toEqual(expect.arrayContaining([
      'Couch', 'Dish', 'washer',
    ]));
  });

  it('selects, hit-tests, and outlines rotated staff amenities from the one fixture collection', () => {
    const amenity = { id: 'bed1', type: 'bed', x: 200, y: 200, rotation: 1, slots: [] };
    const state = baseState({ staffAmenities: [amenity] });
    const geometry = getAmenityGeometry(amenity);
    const hit = findClickedEntity(state, camera, geometry.footprint.x + 10, geometry.footprint.y + 10);
    expect(hit).toMatchObject({ type: 'staffAmenity', data: amenity });
    expect(selectFurnitureInRect(state, {
      x1: geometry.footprint.x - 1,
      y1: geometry.footprint.y - 1,
      x2: geometry.footprint.x + geometry.footprint.w + 1,
      y2: geometry.footprint.y + geometry.footprint.h + 1,
    })).toEqual([{ type: 'staffAmenity', id: 'bed1' }]);

    const ctx = makeContext();
    drawSelectionLayer(ctx, state, camera, [{ type: 'staffAmenity', id: 'bed1' }]);
    expect(ctx._calls.fills).toContainEqual(expect.objectContaining({ x: 197, y: 197, w: 46, h: 26 }));
  });

  it('keeps amenity hit testing and selection aligned for every quarter turn', () => {
    const staffAmenities = [0, 1, 2, 3].map(rotation => ({
      id: `bed-${rotation}`, type: 'bed', x: 100 + rotation * 80, y: 100, rotation, slots: [],
    }));
    const state = baseState({ staffAmenities });

    for (const amenity of staffAmenities) {
      const footprint = getAmenityGeometry(amenity).footprint;
      expect(findClickedEntity(state, camera,
        footprint.x + footprint.w / 2, footprint.y + footprint.h / 2))
        .toMatchObject({ type: 'staffAmenity', data: amenity });
      expect(selectFurnitureInRect(state, {
        x1: footprint.x + 1,
        y1: footprint.y + 1,
        x2: footprint.x + footprint.w - 1,
        y2: footprint.y + footprint.h - 1,
      })).toEqual([{ type: 'staffAmenity', id: amenity.id }]);
    }

    const ctx = makeContext();
    drawSelectionLayer(ctx, state, camera,
      staffAmenities.map(amenity => ({ type: 'staffAmenity', id: amenity.id })));
    expect(ctx._calls.fills).toHaveLength(4);
  });
});

describe('canvas actor presentation', () => {
  it('draws standing staff and customers four world pixels above simulation coordinates', () => {
    const staffContext = makeContext();
    drawStaffLayer(staffContext, baseState({
      staff: [{ id: 's1', name: 'A', role: 'waiter', x: 100, y: 200 }],
    }), camera);
    expect(staffContext._calls.arcs[0]).toMatchObject({ x: 100, y: 196 });

    const customerContext = makeContext();
    drawCustomerLayer(customerContext, baseState({
      customers: [{ id: 'c1', state: 'entering', x: 140, y: 220 }],
    }), camera);
    expect(customerContext._calls.arcs[0]).toMatchObject({ x: 140, y: 216 });
  });

  it('keeps carried visuals attached to the shifted standing staff pose', () => {
    const ctx = makeContext();
    drawStaffLayer(ctx, baseState({
      staff: [{
        id: 's1', name: 'A', role: 'waiter', x: 100, y: 200,
        carryingServiceItemId: 'food',
      }],
      serviceItems: [{ id: 'food', kind: 'dish', menuItemId: 'missing', state: 'carried' }],
    }), camera);

    expect(ctx._calls.arcs[0]).toMatchObject({ x: 100, y: 196 });
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '🍽️', x: 112, y: 182 }));
  });

  it('aligns staff hit testing with the shifted visual marker', () => {
    const staff = { id: 's1', name: 'A', role: 'waiter', x: 100, y: 200, morale: 80 };
    const state = baseState({ staff: [staff] });
    expect(findClickedEntity(state, camera, 100, 196)).toMatchObject({ type: 'staff', data: staff });
    expect(findClickedEntity(state, camera, 100, 213)).toBeNull();
  });

  it('uses couch and bed residency anchors and poses while leaving arcade occupants standing', () => {
    const couch = {
      id: 'couch', type: 'couch', x: 100, y: 100, rotation: 0,
      slots: [{ index: 0, reservedBy: null, occupiedBy: 'couch-staff' },
        { index: 1, reservedBy: null, occupiedBy: 'couch-staff-2' }],
    };
    const bed = {
      id: 'bed', type: 'bed', x: 200, y: 100, rotation: 1,
      slots: [{ index: 0, reservedBy: null, occupiedBy: 'bed-staff' }],
    };
    const arcade = {
      id: 'arcade', type: 'arcade', x: 300, y: 100, rotation: 0,
      slots: [{ index: 0, reservedBy: null, occupiedBy: 'arcade-staff' }],
    };
    const staff = [
      {
        id: 'couch-staff', name: 'C1', role: 'waiter', x: 0, y: 0,
        movementResidency: { kind: 'staff_amenity', amenityId: 'couch', slotIndex: 0 },
        amenityUse: { phase: 'occupied', amenityId: 'couch', slotIndex: 0,
          activityStartedAt: 100, activityEndsAt: 1000, lastRecoveryAt: 100 },
      },
      {
        id: 'couch-staff-2', name: 'C2', role: 'waiter', x: 0, y: 0,
        movementResidency: { kind: 'staff_amenity', amenityId: 'couch', slotIndex: 1 },
        amenityUse: { phase: 'occupied', amenityId: 'couch', slotIndex: 1,
          activityStartedAt: 200, activityEndsAt: 1100, lastRecoveryAt: 200 },
      },
      {
        id: 'bed-staff', name: 'B', role: 'janitor', x: 0, y: 0,
        movementResidency: { kind: 'staff_amenity', amenityId: 'bed', slotIndex: 0 },
        amenityUse: { phase: 'occupied', amenityId: 'bed', slotIndex: 0,
          activityStartedAt: 100, activityEndsAt: 5000, lastRecoveryAt: 100 },
        ptoSession: { sleepStartedAt: 100, minimumEndAt: 1600, startingMorale: 50 },
      },
      {
        id: 'arcade-staff', name: 'A', role: 'cook', x: 320, y: 150,
        amenityUse: { phase: 'occupied', amenityId: 'arcade', slotIndex: 0,
          activityStartedAt: 100, activityEndsAt: 700, lastRecoveryAt: 100 },
      },
    ];
    const ctx = makeContext();
    drawStaffLayer(ctx, baseState({
      restaurant: { expansionLevel: 1, gameTime: 500 },
      staffAmenities: [couch, bed, arcade],
      staff,
    }), camera);

    const couchGeometry = getAmenityGeometry(couch);
    const bedGeometry = getAmenityGeometry(bed);
    expect(ctx._calls.arcs).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: couchGeometry.slotAnchors[0].x, y: couchGeometry.slotAnchors[0].y }),
      expect.objectContaining({ x: couchGeometry.slotAnchors[1].x, y: couchGeometry.slotAnchors[1].y }),
      expect.objectContaining({ x: bedGeometry.slotAnchors[0].x, y: bedGeometry.slotAnchors[0].y }),
      expect.objectContaining({ x: 320, y: 146 }),
    ]));
    expect(ctx._calls.rotations.length).toBeGreaterThan(0);

    const timerFills = ctx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0
      && rect.h <= 14 && rect.fillStyle === '#ffd400');
    expect(timerFills).toHaveLength(4);
    expect(new Set(timerFills.map(rect => rect.x)).size).toBeGreaterThan(2);
  });

  it('draws individual food patience separately from an eating action timer', () => {
    const ctx = makeContext();
    drawCustomerLayer(ctx, baseState({
      restaurant: { expansionLevel: 1, gameTime: 25 },
      tables: [{ id: 'food-table', x: 100, y: 200 }],
      chairs: [
        { id: 'waiting-chair', tableId: 'food-table', x: 80, y: 200, rotation: 0 },
        { id: 'eating-chair', tableId: 'food-table', x: 140, y: 200, rotation: 0 },
      ],
      customers: [
        {
          id: 'waiting', state: 'waiting_for_items', x: 100, y: 200,
          tableId: 'food-table', chairId: 'waiting-chair',
          foodOrderedAt: 0, foodPatienceBudget: 100, foodDeadlineAt: 100,
          foodOutcome: 'pending',
        },
        {
          id: 'eating', state: 'eating', x: 200, y: 200,
          tableId: 'food-table', chairId: 'eating-chair',
          foodOutcome: 'delivered',
        },
      ],
      serviceItems: [{
        id: 'dish', customerId: 'eating', kind: 'dish', state: 'delivered',
        consumptionStartedAt: 0,
      }],
    }), camera);

    expect(ctx._calls.rects.some(rect => rect.fillStyle === '#ff9f43')).toBe(true);
    expect(ctx._calls.rects.filter(rect => rect.w === 1 && rect.fillStyle === '#ffd400')).toHaveLength(1);
  });
});

describe('canvas interpolation at solid residency transitions', () => {
  it('does not interpolate a staff actor through a couch or bed when residency changes', () => {
    const previous = {
      staff: [{ id: 's1', x: 110, y: 130, amenityUse: { phase: 'reserved' } }],
      customers: [], queue: [],
    };
    const current = {
      staff: [{ id: 's1', x: 110, y: 110,
        amenityUse: { phase: 'occupied' },
        movementResidency: { kind: 'staff_amenity', amenityId: 'c1', slotIndex: 0 },
      }],
      customers: [], queue: [],
    };

    expect(interpolateSimulationState(previous, current, 0.5).staff[0]).toMatchObject({
      x: 110, y: 110,
    });
  });
});

void vi;
