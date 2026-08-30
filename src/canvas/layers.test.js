import { describe, expect, it } from 'vitest';
import { drawOverlayLayer, drawStaffLayer, drawCustomerLayer, drawFloorLayer, drawFurnitureLayer, drawQueueLayer } from './layers';
import { updateStaff } from '../simulation/staff';
import { processKitchen } from '../simulation/kitchen';

function recordCtx(extraCanvas = {}) {
  const calls = {
    arcs: [], texts: [], rects: [], rectColours: [], strokeRects: [],
    fills: [], moves: [], lines: [], strokes: [],
  };
  let alpha = 1;
  let offsetX = 0;
  let offsetY = 0;
  let figureScale = 1;
  const transforms = [];
  const point = (x, y) => ({ x: offsetX + x * figureScale, y: offsetY + y * figureScale });
  return {
    canvas: { height: 600, width: 800, ...extraCanvas },
    save: () => { calls.saves = (calls.saves || 0) + 1; transforms.push([offsetX, offsetY, figureScale]); },
    restore: () => { calls.restores = (calls.restores || 0) + 1; [offsetX, offsetY, figureScale] = transforms.pop(); },
    translate: (x, y) => { offsetX += x; offsetY += y; },
    rotate: radians => {
      calls.rotations = [...(calls.rotations || []), radians];
    },
    scale: (x, y) => { calls.scales = [...(calls.scales || []), { x, y }]; figureScale *= x; },
    measureText: (text) => ({ width: String(text).length }),
    beginPath: () => {},
    moveTo: (x, y) => calls.moves.push(point(x, y)),
    lineTo: (x, y) => calls.lines.push(point(x, y)),
    stroke() { calls.strokes.push({ colour: this.strokeStyle }); },
    fillStyle: '',
    get globalAlpha() { return alpha; },
    set globalAlpha(value) { alpha = value; },
    font: '',
    lineWidth: 1,
    arc: (x, y, r, start, end) => calls.arcs.push({ ...point(x, y), r, start, end, alpha }),
    fill: () => calls.fills.push({}),
    fillRect(x, y, w, h) {
      const rect = { ...point(x, y), w: w * figureScale, h: h * figureScale };
      calls.rects.push(rect);
      calls.rectColours.push({ ...rect, colour: this.fillStyle });
    },
    fillText: (text, x, y) => calls.texts.push({ text, x, y, alpha }),
    strokeRect(x, y, w, h) {
      calls.strokeRects.push({
        ...point(x, y), w: w * figureScale, h: h * figureScale, colour: this.strokeStyle,
      });
    },
    _calls: calls,
  };
}

describe('drawFloorLayer', () => {
  it('renders outside the restaurant in AMOLED black', () => {
    const fills = [];
    const ctx = {
      canvas: { width: 800, height: 600 },
      fillStyle: '',
      font: '',
      lineWidth: 1,
      save: () => {},
      restore: () => {},
      translate: () => {},
      scale: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      strokeRect: () => {},
      fillText: () => {},
      fillRect(x, y, width, height) {
        fills.push({ colour: this.fillStyle, x, y, width, height });
      },
    };

    drawFloorLayer(ctx, { restaurant: { expansionLevel: 1 } }, { x: 0, y: 0, zoom: 1 });

    expect(fills[0]).toEqual({ colour: '#000000', x: 0, y: 0, width: 800, height: 600 });
    expect(fills).toContainEqual(expect.objectContaining({ colour: '#000000', width: 6, height: 40 }));
  });

  it('identifies the cashier and renders every purchased doorway', () => {
    const ctx = recordCtx();

    drawFloorLayer(ctx, {
      restaurant: { expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340 }, { id: 'door2', y: 440 }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts.map(call => call.text)).toContain('$ CASHIER');
    expect(ctx._calls.rects.filter(rect => rect.w === 6 && rect.h === 40)).toHaveLength(2);
  });

  it('draws the cashier counter in the top-right from state', () => {
    const ctx = recordCtx();

    drawFloorLayer(ctx, {
      restaurant: { expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340 }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.rects).toContainEqual({ x: 800, y: 120, w: 80, h: 40 });
    expect(ctx._calls.texts.map(call => call.text)).toContain('$ CASHIER');
  });
});

describe('drawFurnitureLayer', () => {
  it('draws dining tables without visible numbering', () => {
    const ctx = recordCtx();
    ctx.fillText = function fillText(text, x, y) {
      this._calls.texts.push({ text, x, y, colour: this.fillStyle, font: this.font });
    };
    const state = {
      tables: [
        { id: 't1', x: 100, y: 100, status: 'empty' },
        { id: 't2', x: 200, y: 100, status: 'empty' },
        { id: 't3', x: 300, y: 100, status: 'empty' },
      ],
       chairs: [], kitchenStations: [], serviceTables: [], serviceItems: [], equipment: [], dishes: [],
    };

    drawFurnitureLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.rects).toContainEqual({ x: 100, y: 100, w: 40, h: 40 });
    expect(ctx._calls.rects).toContainEqual({ x: 200, y: 100, w: 40, h: 40 });
    expect(ctx._calls.rects).toContainEqual({ x: 300, y: 100, w: 40, h: 40 });
    expect(ctx._calls.texts.some(call => /Table \d|Chair \d/.test(call.text))).toBe(false);
  });

  it('draws on-service and delivered item emojis at their stored positions', () => {
    const ctx = recordCtx();
    const state = {
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [],
      dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [
        { id: 'i1', kind: 'dish', menuItemId: 'toast', state: 'on_service', x: 150, y: 130 },
        { id: 'i2', kind: 'drink', menuItemId: 'water', state: 'delivered', x: 224, y: 208 },
        { id: 'i3', kind: 'drink', menuItemId: 'tea', state: 'to_clean', x: 240, y: 208 },
      ],
    };

    drawFurnitureLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '🍞', x: 150, y: 130 }));
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '💧', x: 224, y: 208 }));
    expect(ctx._calls.texts.some(call => call.text === '🍵')).toBe(false);
  });

  it('does not render non-physical or unpositioned service items', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [], dishes: [],
      serviceItems: [
        { id: 'ordered', kind: 'dish', menuItemId: 'toast', state: 'ordered', x: null, y: null },
        { id: 'preparing', kind: 'dish', menuItemId: 'toast', state: 'preparing', x: 0, y: 0 },
        { id: 'ready', kind: 'dish', menuItemId: 'toast', state: 'ready', x: 10, y: 10 },
        { id: 'invalid', kind: 'dish', menuItemId: 'toast', state: 'on_service', x: NaN, y: 10 },
      ],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts).toEqual([]);
  });

  it('shows an arrow for a chair direction', () => {
    const ctx = recordCtx();
    const state = {
      tables: [],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 120, rotation: 1 }],
      kitchenStations: [],
      serviceTables: [],
      serviceItems: [],
      equipment: [],
      dishes: [],
    };

    drawFurnitureLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '→', x: 110, y: 130 }));
  });

  it('draws dirt, station labels, queue stacks, and exact half progress', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, { tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [], dishes: [],
      floorDirt: [{ x: 100, y: 100 }, { x: Infinity, y: 20 }], restaurant: { gameTime: 90 },
      washStations: [{ id: 'sink', type: 'manual', x: 20, y: 20 }, { id: 'auto', type: 'automatic', x: 100, y: 20 }],
      serviceItems: [{ id: 'a', washStationId: 'auto', state: 'washing', washStartedAt: 0 },
        { id: 'b', washStationId: 'auto', state: 'queued_for_wash' }] }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.texts.map(call => call.text)).toEqual(expect.arrayContaining([
      '💦', 'SINK', 'AUTO', '0 / 8', '2 / 12',
    ]));
    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ x: 143, y: 45, w: 1, h: 7 }));
  });

  it('renders stationary customer and staff progress exactly once and suppresses invalid or moving staff', () => {
    const ctx = recordCtx();
    drawCustomerLayer(ctx, { restaurant: { gameTime: 90 }, tables: [{ id: 't', x: 80, y: 80 }], chairs: [{ id: 'ch', tableId: 't', x: 90, y: 90 }],
      customers: [{ id: 'c', state: 'eating', tableId: 't', chairId: 'ch', consumptionStartedAt: 0, consumptionDuration: 180 }] }, { x: 0, y: 0, zoom: 1 });
    drawStaffLayer(ctx, { restaurant: { gameTime: 30 }, serviceItems: [], dishes: [], kitchenStations: [], equipment: [],
      staff: [
        { id: 'o', name: 'O', role: 'waiter', x: 200, y: 200, task: { type: 'take_order', startedAt: 0 }, path: [] },
        { id: 'p', name: 'P', role: 'waiter', x: 240, y: 200, task: { type: 'take_payment', startedAt: 0 }, path: [] },
        { id: 'w', name: 'W', role: 'janitor', x: 280, y: 200, task: { type: 'clean_floor', cleaningStartedAt: 0 }, path: [] },
        { id: 'x', name: 'X', role: 'janitor', x: 320, y: 200, task: { type: 'wash_item', washingStartedAt: 0 }, path: [{ x: 1, y: 1 }] },
        { id: 'i', name: 'I', role: 'janitor', x: 360, y: 200, task: { type: 'wash_item', washingStartedAt: null }, path: [] },
      ] }, { x: 0, y: 0, zoom: 1 });
    const progressFills = ctx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14);
    expect(progressFills).toHaveLength(4);
    expect(progressFills.map(fill => fill.h)).toEqual(expect.arrayContaining([7, 7, 7, 10.5]));
  });

  it('suppresses consumption progress for a moving eating customer with valid timestamps', () => {
    const moving = recordCtx();
    drawCustomerLayer(moving, { restaurant: { gameTime: 90 }, tables: [{ id: 't', x: 80, y: 80 }], chairs: [{ id: 'ch', tableId: 't', x: 90, y: 90 }], customers: [
      { id: 'moving', state: 'eating', tableId: 't', chairId: 'ch', path: [{ x: 5, y: 5 }], consumptionStartedAt: 0, consumptionDuration: 180 },
    ] }, { x: 0, y: 0, zoom: 1 });
    expect(moving._calls.arcs).toHaveLength(1);
    expect(moving._calls.arcs[0]).toMatchObject({ x: 100, y: 95 });
    expect(moving._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14)).toHaveLength(0);

    const stationary = recordCtx();
    drawCustomerLayer(stationary, { restaurant: { gameTime: 90 }, tables: [{ id: 't', x: 80, y: 80 }], chairs: [{ id: 'ch', tableId: 't', x: 90, y: 90 }], customers: [
      { id: 'stationary', state: 'eating', tableId: 't', chairId: 'ch', path: [], consumptionStartedAt: 0, consumptionDuration: 180 },
    ] }, { x: 0, y: 0, zoom: 1 });
    expect(stationary._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14)).toHaveLength(1);
  });

  it('uses canonical drink, recipe/equipment, and manual wash durations', () => {
    const ctx = recordCtx();
    drawStaffLayer(ctx, {
      restaurant: { gameTime: 30 },
      serviceItems: [
        { id: 'drink', kind: 'drink', preparationStartedAt: 0, menuItemId: 'water' },
        { id: 'food', kind: 'dish', preparationStartedAt: 0, menuItemId: 'dish', stationId: 'k1' },
      ],
      dishes: [{ id: 'dish', prepTime: 100 }],
      kitchenStations: [{ id: 'k1', equipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 2 }],
      staff: [
        { id: 'd', name: 'D', role: 'waiter', x: 100, y: 100, path: [], task: { type: 'prepare_drink', serviceItemId: 'drink' } },
        { id: 'f', name: 'F', role: 'cook', x: 200, y: 100, path: [], task: { type: 'prepare_dish', serviceItemId: 'food', stationId: 'k1' } },
        { id: 'm', name: 'M', role: 'janitor', x: 300, y: 100, path: [], task: { type: 'wash_item', washingStartedAt: 0 } },
      ],
    }, { x: 0, y: 0, zoom: 1 });
    const fills = ctx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14);
    expect(fills).toHaveLength(3);
    expect(fills.map(fill => fill.h)).toEqual(expect.arrayContaining([
      10.5, 5.6000000000000005, 12.6,
    ]));
  });

  it('suppresses delivered-item drawing for overlapping chair geometry', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [{ id: 't1', x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 205, y: 205 }],
      customers: [{ id: 'c1', tableId: 't1', chairId: 'ch1' }],
      kitchenStations: [], serviceTables: [], equipment: [], dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [{ id: 'dish', kind: 'dish', menuItemId: 'toast', customerId: 'c1', state: 'delivered', x: 208, y: 208 }],
    }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.texts.some(call => call.text === '🍞')).toBe(false);
  });

  it('renders production cook progress from preparation start until kitchen completion', () => {
    const station = { id: 'k1', equipmentId: 'eq1', x: 100, y: 100 };
    const state = {
      restaurant: { gameTime: 100 }, customers: [{ id: 'customer', state: 'waiting_for_items', dishId: 'dish' }],
      queue: [], tables: [], chairs: [], floorDirt: [], washStations: [], serviceTables: [{ id: 'st1', x: 200, y: 100 }],
      dishes: [{ id: 'dish', prepTime: 60, requiredEquipmentId: 'eq1' }],
      equipment: [{ id: 'eq1', owned: true, speedMultiplier: 1 }], kitchenStations: [station],
      staff: [{ id: 'cook', name: 'Cook', role: 'cook', morale: 80, x: 80, y: 120, path: [],
        task: { type: 'prepare_dish', serviceItemId: 'food', stationId: 'k1' } }],
      serviceItems: [{ id: 'food', kind: 'dish', menuItemId: 'dish', customerId: 'customer', state: 'ordered' }],
    };
    const preparing = updateStaff(state, 0);
    expect(preparing.staff[0].task).toMatchObject({ type: 'prepare_dish', serviceItemId: 'food' });
    expect(preparing.serviceItems[0]).toMatchObject({ state: 'preparing', preparationStartedAt: 100 });
    const ctx = recordCtx();
    drawStaffLayer(ctx, { ...preparing, restaurant: { gameTime: 130 } }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ w: 1, h: 7 }));

    const completed = processKitchen({ ...preparing, restaurant: { gameTime: 160 } });
    expect(completed.staff[0].task).toBeNull();
    expect(completed.serviceItems[0].state).toBe('on_service');
  });
});

describe('drawOverlayLayer', () => {
  it('uses the tooltip argument when called with sprites before tooltip text', () => {
    const calls = [];
    const ctx = {
      canvas: { height: 200 },
      fillStyle: '',
      font: '',
      measureText: text => ({ width: String(text).length }),
      fillRect: () => {},
      fillText: text => calls.push(text),
    };

    drawOverlayLayer(ctx, {}, {}, {}, 'Station k1');

    expect(calls).toContain('Station k1');
    expect(calls).not.toContain('[object Object]');
  });
});

describe('drawStaffLayer', () => {
  const camera = { x: 0, y: 0, zoom: 1 };

  it('uses dynamic s.x/s.y when both are finite', () => {
    const staff = [
      { id: 's1', name: 'Marco', role: 'cook', x: 150, y: 200, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    expect(ctx._calls.arcs[0].x).toBe(150);
    expect(ctx._calls.arcs[0].y).toBe(200);
  });

  it('renders staff as a stick figure with arms and hands', () => {
    const state = {
      staff: [{ id: 's1', name: 'Marco', role: 'cook', x: 150, y: 200, morale: 80 }],
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();

    drawStaffLayer(ctx, state, camera);

    expect(ctx._calls.lines.length).toBeGreaterThanOrEqual(5);
    expect(ctx._calls.rects).toContainEqual({ x: 141, y: 210, w: 2, h: 2 });
    expect(ctx._calls.rects).toContainEqual({ x: 157, y: 210, w: 2, h: 2 });
  });

  it('uses gender palettes for staff figures and their names', () => {
    const state = {
      staff: [
        { id: 's1', name: 'Marco', gender: 'male', role: 'cook', x: 150, y: 200, morale: 80 },
        { id: 's2', name: 'Sofia', gender: 'female', role: 'waiter', x: 250, y: 200, morale: 80 },
      ],
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();
    ctx.fillText = function fillText(text, x, y) {
      this._calls.texts.push({ text, x, y, colour: this.fillStyle });
    };

    drawStaffLayer(ctx, state, camera);

    expect(ctx._calls.strokes).toContainEqual({ colour: '#39a9db' });
    expect(ctx._calls.strokes).toContainEqual({ colour: '#e66a9c' });
    expect(ctx._calls.texts.find(call => call.text === 'Marco').colour).toBe('#8edcff');
    expect(ctx._calls.texts.find(call => call.text === 'Sofia').colour).toBe('#ffadd0');
  });

  it('changes the limb pose while walking and keeps idle staff still', () => {
    const moving = {
      staff: [{ id: 's1', name: 'Marco', gender: 'male', role: 'cook', x: 150, y: 200, morale: 80, path: [{ x: 1, y: 1 }] }],
      restaurant: { expansionLevel: 1 },
    };
    const idle = { ...moving, staff: [{ ...moving.staff[0], path: [] }] };
    const movingStart = recordCtx();
    const movingLater = recordCtx();
    const idleStart = recordCtx();
    const idleLater = recordCtx();

    drawStaffLayer(movingStart, moving, camera, { timeMs: 0, reducedMotion: false });
    drawStaffLayer(movingLater, moving, camera, { timeMs: 200, reducedMotion: false });
    drawStaffLayer(idleStart, idle, camera, { timeMs: 0, reducedMotion: false });
    drawStaffLayer(idleLater, idle, camera, { timeMs: 200, reducedMotion: false });

    expect(movingStart._calls.lines).not.toEqual(movingLater._calls.lines);
    expect(idleStart._calls.lines).toEqual(idleLater._calls.lines);
  });

  it('stacks names when staff occupy the same area', () => {
    const staff = [
      { id: 's1', name: 'Sofia', role: 'waiter', x: 200, y: 200, morale: 80 },
      { id: 's2', name: 'Anna', role: 'waiter', x: 202, y: 200, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();

    drawStaffLayer(ctx, state, camera);

    const names = ctx._calls.texts.filter(call => ['Sofia', 'Anna'].includes(call.text));
    expect(names).toEqual([
      expect.objectContaining({ text: 'Sofia', x: 200, y: 186 }),
      expect.objectContaining({ text: 'Anna', x: 202, y: 176 }),
    ]);
  });

  it('falls back to getDefaultStaffPosition when coords are missing', () => {
    const staff = [
      { id: 's1', name: 'Marco', role: 'cook', morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    // getDefaultStaffPosition for cook index 0 at expansionLevel 1: world.floorX=50, world.kitchenY=50
    // x = 50 + 40 + 0*45 = 90, y = 50 + 25 = 75
    expect(ctx._calls.arcs[0].x).toBe(90);
    expect(ctx._calls.arcs[0].y).toBe(75);
  });

  it('falls back when x is not finite', () => {
    const staff = [
      { id: 's1', name: 'Marco', role: 'cook', x: NaN, y: 200, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.arcs[0].x).toBe(90);
    expect(ctx._calls.arcs[0].y).toBe(75);
  });

  it('falls back to the assigned cashier position when waiter coordinates are missing', () => {
    const state = {
      staff: [{ id: 'w1', name: 'Elena', role: 'waiter', morale: 80 }],
      cashierStations: [{
        id: 'cashier1', x: 800, y: 120, w: 80, h: 40, assignedStaffId: 'w1',
      }],
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();

    drawStaffLayer(ctx, state, camera);

    expect(ctx._calls.arcs[0]).toMatchObject({ x: 840, y: 100 });
  });

  it('does not render staff task text on the main canvas', () => {
    const state = {
      staff: [{ id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80, task: { type: 'take_order' } }],
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();

    drawStaffLayer(ctx, state, camera);

    expect(ctx._calls.texts.some(call => call.text === 'take_order')).toBe(false);
  });

  it('does not show task label when staff has no task', () => {
    const staff = [
      { id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    const taskTexts = ctx._calls.texts.filter(t => t.text && t.text.includes('take_order'));
    expect(taskTexts.length).toBe(0);
  });

  it('animates a stationary cleaning cloth without moving the staff member or striding', () => {
    const state = {
      staff: [{
        id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80,
        path: [], task: { type: 'clean_table', tableId: 't1' },
      }],
      restaurant: { expansionLevel: 1 },
    };
    const start = recordCtx();
    const later = recordCtx();
    const reducedStart = recordCtx();
    const reducedLater = recordCtx();

    drawStaffLayer(start, state, camera, { timeMs: 0, reducedMotion: false });
    drawStaffLayer(later, state, camera, { timeMs: 200, reducedMotion: false });
    drawStaffLayer(reducedStart, state, camera, { timeMs: 0, reducedMotion: true });
    drawStaffLayer(reducedLater, state, camera, { timeMs: 200, reducedMotion: true });

    expect(start._calls.arcs[0]).toEqual(later._calls.arcs[0]);
    expect(start._calls.lines).not.toEqual(later._calls.lines);
    expect(start._calls.lines.at(-1)).not.toEqual(later._calls.lines.at(-1));
    expect(start._calls.lines.slice(3, 5)).toEqual(later._calls.lines.slice(3, 5));
    expect(reducedStart._calls.lines).toEqual(reducedLater._calls.lines);
    expect(reducedStart._calls.rects).toEqual(reducedLater._calls.rects);
  });

  it('shows the carried dish emoji when carryingServiceItemId is set', () => {
    const staff = [
      { id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80, carryingServiceItemId: 'f1' },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 }, serviceItems: [{ id: 'f1', kind: 'dish', menuItemId: 'dish' }], dishes: [{ id: 'dish', base: 'Bread' }] };
    const ctx = recordCtx();
    ctx.fillText = function fillText(text, x, y) {
      this._calls.texts.push({ text, x, y, font: this.font });
    };
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '🍞', font: '12px sans-serif' }));
  });

  it('shows the carried drink emoji when carrying a drink', () => {
    const staff = [
      { id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80, carryingServiceItemId: 'd1' },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 }, serviceItems: [{ id: 'd1', kind: 'drink', menuItemId: 'water' }], dishes: [] };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.texts.some(t => t.text === '💧')).toBe(true);
    expect(ctx._calls.texts.some(t => t.text === 'F')).toBe(false);
  });

  it('does not leak fading alpha between customers and preserves reduced-motion coordinates', () => {
    const state = {
      customers: [
        { id: 'fade', state: 'leaving', exitPhase: 'fading', exitFadeProgress: 0.4, x: 500, y: 300, path: [] },
        { id: 'solid', state: 'guided', x: 700, y: 350, path: [] },
      ], tables: [], chairs: [], restaurant: {},
    };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera, { timeMs: 200, reducedMotion: true });
    expect(ctx._calls.arcs).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 500, y: 300, alpha: 0.6 }),
      expect.objectContaining({ x: 700, y: 350, alpha: 1 }),
    ]));
    expect(ctx._calls.saves).toBe(5);
    expect(ctx._calls.restores).toBe(5);
    expect(ctx._calls.lines).toEqual(expect.any(Array));
  });

  it('suppresses fading limb animation in reduced motion at every time', () => {
    const state = {
      customers: [{ id: 'fade', state: 'leaving', exitPhase: 'fading', exitFadeProgress: 0.4, x: 500, y: 300, path: [] }],
      tables: [], chairs: [], restaurant: {},
    };
    const first = recordCtx();
    const second = recordCtx();
    drawCustomerLayer(first, state, camera, { timeMs: 0, reducedMotion: true });
    drawCustomerLayer(second, state, camera, { timeMs: 200, reducedMotion: true });
    expect(first._calls.lines).toEqual(second._calls.lines);
    expect(first._calls.arcs[0]).toMatchObject({ x: 500, y: 300, alpha: 0.6 });
    expect(second._calls.arcs[0]).toMatchObject({ x: 500, y: 300, alpha: 0.6 });
  });

  it('uses the dish fallback when malformed truthy dishes accompany an item', () => {
    const ctx = recordCtx();
    expect(() => drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [],
      dishes: {}, serviceItems: [{ id: 'i', kind: 'dish', menuItemId: 'missing', state: 'on_service', x: 10, y: 20 }],
    }, camera)).not.toThrow();
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '🍽️', x: 10, y: 20 }));
  });

  it('safely ignores malformed service-item arrays', () => {
    expect(() => drawFurnitureLayer(recordCtx(), {
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [],
      dishes: [], serviceItems: {},
    }, camera)).not.toThrow();
    expect(() => drawStaffLayer(recordCtx(), {
      staff: [{ id: 's', name: 'A', role: 'waiter', x: 1, y: 1, carryingServiceItemId: 'x' }],
      serviceItems: true, dishes: [], restaurant: {},
    }, camera)).not.toThrow();
  });
});

describe('drawCustomerLayer', () => {
  const camera = { x: 0, y: 0, zoom: 1 };

  it('fits an upright deciding customer into its chair and places its menu towards the table', () => {
    const ctx = recordCtx();
    drawCustomerLayer(ctx, {
      customers: [{ id: 'c1', state: 'seated', chairId: 'ch1', tableId: 't1', x: 800, y: 400 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 100 }],
      tables: [{ id: 't1', x: 140, y: 90 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.arcs).toContainEqual(expect.objectContaining({ x: 110, y: 105 }));
    expect(ctx._calls.rects).toContainEqual({ x: 108, y: 102, w: 24, h: 16 });
    expect(ctx._calls.rotations.at(-1)).toBe(0);
  });

  it.each([
    ['seated', { state: 'seated', dishId: null }, { x: 110, y: 105 }],
    ['ordering', { state: 'ordering', dishId: 'dish' }, { x: 110, y: 105 }],
    ['eating', { state: 'eating', dishId: 'dish' }, { x: 110, y: 105 }],
    ['waiting_for_items', { state: 'waiting_for_items', dishId: 'dish' }, { x: 110, y: 105 }],
    ['moving', { state: 'guided', path: [{ x: 801, y: 401 }] }, { x: 800, y: 400 }],
    ['paying', { state: 'paying' }, { x: 800, y: 400 }],
  ])('uses chair geometry only for seated visual states: %s', (_label, customer, expected) => {
    const ctx = recordCtx();
    drawCustomerLayer(ctx, {
      customers: [{ id: 'c1', chairId: 'ch1', tableId: 't1', x: 800, y: 400, ...customer }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 100 }],
      tables: [{ id: 't1', x: 140, y: 90 }],
    }, camera);

    expect(ctx._calls.arcs).toContainEqual(expect.objectContaining(expected));
  });

  it('renders guided customer at dynamic x/y even without tableId', () => {
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'guided', x: 850, y: 370, guideStaffId: 'w1' },
    ];
    const state = { customers, tables: [], restaurant: {} };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    expect(ctx._calls.arcs[0].x).toBe(850);
    expect(ctx._calls.arcs[0].y).toBe(370);
  });

  it('renders seated customer on their assigned chair instead of the table', () => {
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'seated', tableId: 't1', chairId: 'ch1' },
    ];
    const tables = [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }];
    const chairs = [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }];
    const state = { customers, tables, chairs, restaurant: {} };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    expect(ctx._calls.arcs[0].x).toBe(220);
    expect(ctx._calls.arcs[0].y).toBe(185);
  });

  it('shows a cream open-book menu held by a seated customer who is deciding', () => {
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'seated', tableId: 't1', chairId: 'ch1', dishId: null },
    ];
    const tables = [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }];
    const chairs = [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }];
    const state = { customers, tables, chairs, restaurant: {} };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.lines.length).toBeGreaterThanOrEqual(5);
    expect(ctx._calls.rectColours).toContainEqual({
      x: 208, y: 192, w: 24, h: 16, colour: '#f3e6bd',
    });
    expect(ctx._calls.strokeRects).toContainEqual({
      x: 208, y: 192, w: 24, h: 16, colour: '#4d3a1f',
    });
  });

  it.each([0, 1, 2, 3])('keeps a seated customer upright at chair rotation %s', rotation => {
    const ctx = recordCtx();
    drawCustomerLayer(ctx, {
      customers: [{ id: 'c1', state: 'seated', tableId: 't1', chairId: 'ch1' }],
      tables: [{ id: 't1', x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation }],
      restaurant: {},
    }, camera);
    expect(ctx._calls.rotations).toContain(0);
    expect(ctx._calls.rotations).not.toContain(Math.PI / 2);
    expect(ctx._calls.rotations).not.toContain(Math.PI);
    expect(ctx._calls.rotations).not.toContain(-Math.PI / 2);
  });

  it('keeps the menu visible while a customer is ordering', () => {
    const state = {
      customers: [{ id: 'c1', archetype: 'regular', gender: 'female', state: 'ordering', tableId: 't1', chairId: 'ch1', dishId: 'd1' }],
      tables: [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: {},
    };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.rects).toContainEqual({ x: 208, y: 192, w: 24, h: 16 });
    expect(ctx._calls.strokes).toContainEqual({ colour: '#e66a9c' });
    expect(ctx._calls.texts.some(call => call.text === 'ordering')).toBe(false);
  });

  it.each([0, 1, 2, 3])('keeps the ordering menu upright at chair rotation %s', rotation => {
    const state = {
      customers: [{
        id: 'c1', archetype: 'regular', gender: 'female', state: 'ordering',
        tableId: 't1', chairId: 'ch1', dishId: 'd1',
      }],
      tables: [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation }],
      restaurant: {},
    };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.rects).toContainEqual({ x: 208, y: 192, w: 24, h: 16 });
    expect(ctx._calls.moves).toContainEqual({ x: 220, y: 193 });
    expect(ctx._calls.lines).toContainEqual({ x: 220, y: 207 });
  });

  it('hides the menu after the order while waiting for items', () => {
    const state = {
      customers: [{
        id: 'c1', archetype: 'regular', state: 'waiting_for_items',
        tableId: 't1', chairId: 'ch1', dishId: 'd1',
      }],
      tables: [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180, rotation: 0 }],
      restaurant: {},
    };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.rects).not.toContainEqual({ x: 208, y: 192, w: 24, h: 16 });
  });

  it('does not render seated customers without an explicit valid chair', () => {
    const state = {
      customers: [{ id: 'c1', archetype: 'regular', state: 'seated', tableId: 't1', dishId: null }],
      tables: [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: {},
    };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.arcs).toHaveLength(0);
    expect(ctx._calls.rects).toHaveLength(0);
  });

  it('renders guided customer by x/y even when tableId is also set', () => {
    // guided customer has tableId assigned but hasn't been seated yet
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'guided', x: 850, y: 370, tableId: 't1', guideStaffId: 'w1' },
    ];
    const tables = [{ id: 't1', x: 200, y: 200, status: 'reserved', seats: 2 }];
    const state = { customers, tables, restaurant: {} };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    // should use dynamic x/y, not table position
    expect(ctx._calls.arcs[0].x).toBe(850);
    expect(ctx._calls.arcs[0].y).toBe(370);
  });

  it('animates customers who are walking towards an exit', () => {
    const state = {
      customers: [{ id: 'c1', gender: 'male', state: 'leaving', x: 500, y: 300, path: [{ x: 30, y: 15 }] }],
      tables: [], chairs: [], restaurant: {},
    };
    const start = recordCtx();
    const later = recordCtx();

    drawCustomerLayer(start, state, camera, { timeMs: 0, reducedMotion: false });
    drawCustomerLayer(later, state, camera, { timeMs: 200, reducedMotion: false });

    expect(start._calls.lines).not.toEqual(later._calls.lines);
  });

  it('renders paying customers at their checkout position instead of their chair', () => {
    const state = {
      customers: [{ id: 'c1', state: 'paying', x: 780, y: 140, tableId: 't1', chairId: 'ch1' }],
      tables: [{ id: 't1', x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      restaurant: {},
    };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.arcs[0]).toMatchObject({ x: 780, y: 140 });
  });

  it('skips customers with no position and no tableId', () => {
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'waiting' },
    ];
    const state = { customers, tables: [], restaurant: {} };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(0);
  });
});

describe('drawQueueLayer', () => {
  it('does not render the literal queue state', () => {
    const state = {
      queue: Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, state: 'waiting' })),
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();

    drawQueueLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts.some(call => call.text === 'waiting')).toBe(false);
    expect(ctx._calls.texts.some(call => call.text === '+1 more')).toBe(true);
  });
});
