import { describe, expect, it } from 'vitest';
import { drawOverlayLayer, drawStaffLayer, drawCustomerLayer, drawFloorLayer, drawFurnitureLayer, drawPlacementPreview, drawQueueLayer } from './layers';
import { updateStaff } from '../simulation/staff';
import { processKitchen } from '../simulation/kitchen';
import { getDishwasherStats } from '../simulation/dishwasherProgression';
import { getPlaceSettingPositions } from './tableGeometry';
import { recordSeatResidency } from '../simulation/movement/seatedDeparture';

function recordCtx(extraCanvas = {}) {
  const calls = {
    arcs: [], texts: [], rects: [], rectColours: [], strokeRects: [],
    fills: [], moves: [], lines: [], strokes: [],
  };
  let alpha = 1;
  let offsetX = 0;
  let offsetY = 0;
  let figureScale = 1;
  let textAlign = 'start';
  let textBaseline = 'alphabetic';
  const transforms = [];
  const point = (x, y) => ({ x: offsetX + x * figureScale, y: offsetY + y * figureScale });
  return {
    canvas: { height: 600, width: 800, ...extraCanvas },
    save: () => {
      calls.saves = (calls.saves || 0) + 1;
      transforms.push([offsetX, offsetY, figureScale, textAlign, textBaseline]);
    },
    restore: () => {
      calls.restores = (calls.restores || 0) + 1;
      [offsetX, offsetY, figureScale, textAlign, textBaseline] = transforms.pop();
    },
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
    get textAlign() { return textAlign; },
    set textAlign(value) { textAlign = value; },
    get textBaseline() { return textBaseline; },
    set textBaseline(value) { textBaseline = value; },
    lineWidth: 1,
    arc: (x, y, r, start, end) => calls.arcs.push({ ...point(x, y), r, start, end, alpha }),
    fill: () => calls.fills.push({}),
    fillRect(x, y, w, h) {
      const rect = { ...point(x, y), w: w * figureScale, h: h * figureScale };
      calls.rects.push(rect);
      calls.rectColours.push({ ...rect, colour: this.fillStyle });
    },
    fillText(text, x, y) {
      calls.texts.push({
        text, x, y, alpha,
        textAlign: this.textAlign,
        textBaseline: this.textBaseline,
      });
    },
    strokeRect(x, y, w, h) {
      calls.strokeRects.push({
        ...point(x, y), w: w * figureScale, h: h * figureScale, colour: this.strokeStyle,
      });
    },
    _calls: calls,
  };
}

function withMovementStatuses(state, records) {
  const requests = new Map();
  const statuses = new Map();
  for (const [id, record] of Object.entries(records)) {
    if (record.goal) requests.set(id, { id, goal: record.goal });
    statuses.set(id, record.status);
  }
  return { ...state, movementCoordinator: { requests, statuses } };
}

describe('drawFloorLayer', () => {
  it('uses the restaurant backdrop outside the fitted world instead of black', () => {
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

    drawFloorLayer(ctx, {
      restaurant: { expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(fills[0]).toEqual({ colour: '#2d1f0e', x: 0, y: 0, width: 800, height: 600 });
    expect(fills).toContainEqual(expect.objectContaining({ colour: '#000000', width: 6, height: 40 }));
  });

  it('identifies the cashier and renders every purchased doorway', () => {
    const ctx = recordCtx();

    drawFloorLayer(ctx, {
      restaurant: { expansionLevel: 1 },
      doors: [
        { id: 'door1', y: 340, role: 'entrance' },
        { id: 'door2', y: 440, role: 'exit' },
      ],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts.map(call => call.text)).toContain('Cashier');
    expect(ctx._calls.texts.map(call => call.text)).not.toContain('QUEUE');
    expect(ctx._calls.rects.filter(rect => rect.w === 6 && rect.h === 40)).toHaveLength(2);
  });

  it('draws the cashier counter in the top-right from state', () => {
    const ctx = recordCtx();

    drawFloorLayer(ctx, {
      restaurant: { expansionLevel: 1 },
      doors: [{ id: 'door1', y: 340, role: 'entrance' }],
      cashierStations: [{ id: 'cashier1', x: 800, y: 120, w: 80, h: 40 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.rects).toContainEqual({ x: 800, y: 120, w: 80, h: 40 });
    expect(ctx._calls.texts.map(call => call.text)).toContain('Cashier');
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

  it('draws on-service items at stored positions and skips delivered items without ownership geometry', () => {
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
    expect(ctx._calls.texts.some(call => call.text === '💧')).toBe(false);
    expect(ctx._calls.texts.some(call => call.text === '🍵')).toBe(false);
  });

  it.each(['preparing', 'ready'])('renders a positioned %s dish on its kitchen station', itemState => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [{ id: 'k1', x: 100, y: 120 }],
      serviceTables: [], equipment: [], dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [{
        id: 'dish', kind: 'dish', menuItemId: 'toast', state: itemState,
        stationId: 'k1', x: 120, y: 140,
      }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({
      text: '🍞', x: 120, y: 140, textAlign: 'center', textBaseline: 'middle',
    }));
  });

  it('does not render ordered or unpositioned service items', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [], dishes: [],
      serviceItems: [
        { id: 'ordered', kind: 'dish', menuItemId: 'toast', state: 'ordered', x: null, y: null },
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

  it('keeps the sink outline inside its four-cell footprint', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [], dishes: [],
      washStations: [{ id: 'sink', type: 'manual', x: 300, y: 120, w: 40, h: 40 }],
      serviceItems: [],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.rects).toContainEqual({ x: 300, y: 120, w: 40, h: 40 });
    expect(ctx._calls.strokeRects).toContainEqual(expect.objectContaining({
      x: 300.5, y: 120.5, w: 39, h: 39,
    }));
  });

  it('draws one canonical manual-wash progress bar across the sink and janitor layers', () => {
    const state = {
      restaurant: { gameTime: 30 },
      tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [], dishes: [],
      washStations: [{ id: 'sink', type: 'manual', x: 300, y: 100, w: 40, h: 40 }],
      serviceItems: [{
        id: 'item', kind: 'dish', state: 'washing', washStationId: 'sink', washStartedAt: 0,
      }],
      staff: [{
        id: 'm', name: 'M', role: 'janitor', x: 300, y: 100, activityPhase: 'working',
        task: { type: 'wash_item', serviceItemId: 'item', washStationId: 'sink', washingStartedAt: 0 },
      }],
    };
    const staffStart = recordCtx();
    const staffLater = recordCtx();
    const furniture = recordCtx();

    drawStaffLayer(staffStart, state, { x: 0, y: 0, zoom: 1 }, { timeMs: 0 });
    drawStaffLayer(staffLater, state, { x: 0, y: 0, zoom: 1 }, { timeMs: 200 });
    drawFurnitureLayer(furniture, state, { x: 0, y: 0, zoom: 1 });

    const progressFills = [...staffStart._calls.rects, ...furniture._calls.rects]
      .filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14);
    expect(progressFills).toHaveLength(1);
    expect(furniture._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toContainEqual(expect.objectContaining({ h: 12.6 }));
    expect(staffStart._calls.lines).not.toEqual(staffLater._calls.lines);
  });

  it('draws a quarter-turned service counter with a vertical footprint', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [], equipment: [], dishes: [], serviceItems: [],
      serviceTables: [{ id: 'vertical', x: 300, y: 120, rotation: 1 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.rects).toContainEqual({ x: 300, y: 120, w: 40, h: 120 });
     expect(ctx._calls.texts).toContainEqual(expect.objectContaining({
       text: 'Service counter', x: 320, y: 180,
     }));
  });

  it('draws dirt, sentence-case station labels, queue stacks, and exact half progress', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, { tables: [], chairs: [], kitchenStations: [], serviceTables: [], equipment: [], dishes: [],
      floorDirt: [{ x: 100, y: 100 }, { x: Infinity, y: 20 }],
      restaurant: { gameTime: getDishwasherStats(1).secondsPerDish / 2 },
      washStations: [{ id: 'sink', type: 'manual', x: 20, y: 20 }, { id: 'auto', type: 'automatic', x: 100, y: 20 }],
      serviceItems: [{ id: 'a', washStationId: 'auto', state: 'washing', washStartedAt: 0 },
        { id: 'b', washStationId: 'auto', state: 'queued_for_wash' }] }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.texts.map(call => call.text)).toEqual(expect.arrayContaining([
      '💦', 'Sink', 'Dish', 'washer', '0 / 8', '2 / 12',
    ]));
    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ x: 143, y: 45, w: 1, h: 7 }));
  });

  it('renders stationary customer and staff progress exactly once and suppresses invalid or moving staff', () => {
    const ctx = recordCtx();
    drawCustomerLayer(ctx, { restaurant: { gameTime: 240 }, tables: [{ id: 't', x: 80, y: 80 }], chairs: [{ id: 'ch', tableId: 't', x: 90, y: 90 }],
      customers: [{ id: 'c', state: 'eating', tableId: 't', chairId: 'ch', consumptionStartedAt: 0, consumptionDuration: 180 }],
      serviceItems: [{ id: 'dish', customerId: 'c', kind: 'dish', state: 'delivered', consumptionStartedAt: 0 }] }, { x: 0, y: 0, zoom: 1 });
    const staffState = withMovementStatuses({ restaurant: { gameTime: 30 }, serviceItems: [], dishes: [], kitchenStations: [], equipment: [],
      staff: [
        { id: 'o', name: 'O', role: 'waiter', x: 200, y: 200, task: { type: 'take_order', startedAt: 0 } },
        { id: 'p', name: 'P', role: 'waiter', x: 240, y: 200, task: { type: 'take_payment', startedAt: 0 } },
        { id: 't', name: 'T', role: 'waiter', x: 280, y: 200, task: { type: 'clean_table', cleaningStartedAt: 0 }, activityPhase: 'working' },
        { id: 'w', name: 'W', role: 'janitor', x: 320, y: 200, task: { type: 'clean_floor', cleaningStartedAt: 0 }, activityPhase: 'working' },
        { id: 'x', name: 'X', role: 'janitor', x: 360, y: 200, navigationGoal: { x: 420, y: 200 }, task: { type: 'wash_item', washingStartedAt: 0 } },
        { id: 'i', name: 'I', role: 'janitor', x: 400, y: 200, task: { type: 'wash_item', washingStartedAt: null } },
      ] }, {
      x: { goal: { x: 420, y: 200 }, status: { plan: 'scheduled', motion: 'holding' } },
    });
    drawStaffLayer(ctx, staffState, { x: 0, y: 0, zoom: 1 });
    const progressFills = ctx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14);
    expect(progressFills).toHaveLength(5);
    expect(progressFills.map(fill => fill.h)).toEqual(expect.arrayContaining([7, 7, 7, 10.5, 10.5]));
  });

  it('uses eating and arrival state rather than route emptiness for consumption progress', () => {
    const goal = { x: 300, y: 300 };
    const base = {
      restaurant: { gameTime: 90 },
      tables: [{ id: 't', x: 80, y: 80 }],
      chairs: [{ id: 'ch', tableId: 't', x: 90, y: 90 }],
      serviceItems: [{ id: 'dish', kind: 'dish', state: 'delivered', consumptionStartedAt: 0 }],
    };
    const enRoute = withMovementStatuses({
      ...base,
      customers: [{
        id: 'en-route', state: 'eating', tableId: 't', chairId: 'ch',
        navigationGoal: goal,
      }],
      serviceItems: [{ ...base.serviceItems[0], customerId: 'en-route' }],
    }, {
      'en-route': { goal, status: { plan: 'scheduled', motion: 'traversing' } },
    });
    const arrived = withMovementStatuses({
      ...base,
      customers: [{
        id: 'arrived', state: 'eating', tableId: 't', chairId: 'ch',
        navigationGoal: goal,
      }],
      serviceItems: [{ ...base.serviceItems[0], customerId: 'arrived' }],
    }, {
      arrived: { goal, status: { plan: 'arrived', motion: 'holding' } },
    });
    const cleared = {
      ...base,
      customers: [{ id: 'cleared', state: 'eating', tableId: 't', chairId: 'ch' }],
      serviceItems: [{ ...base.serviceItems[0], customerId: 'cleared' }],
    };
    const enRouteCtx = recordCtx();
    const arrivedCtx = recordCtx();
    const clearedCtx = recordCtx();

    drawCustomerLayer(enRouteCtx, enRoute, { x: 0, y: 0, zoom: 1 });
    drawCustomerLayer(arrivedCtx, arrived, { x: 0, y: 0, zoom: 1 });
    drawCustomerLayer(clearedCtx, cleared, { x: 0, y: 0, zoom: 1 });

    expect(enRouteCtx._calls.arcs).toHaveLength(1);
    expect(enRouteCtx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toHaveLength(0);
    expect(arrivedCtx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toHaveLength(1);
    expect(clearedCtx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toHaveLength(1);
  });

  it('uses canonical drink and recipe/equipment durations', () => {
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
        { id: 'd', name: 'D', role: 'cook', x: 100, y: 100, task: { type: 'prepare_drink', serviceItemId: 'drink' } },
        { id: 'f', name: 'F', role: 'cook', x: 200, y: 100, task: { type: 'prepare_dish', serviceItemId: 'food', stationId: 'k1' } },
        { id: 'm', name: 'M', role: 'janitor', x: 300, y: 100, task: { type: 'wash_item', washingStartedAt: 0 } },
      ],
    }, { x: 0, y: 0, zoom: 1 });
    const fills = ctx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14);
    expect(fills).toHaveLength(2);
    expect(fills.map(fill => fill.h)).toEqual(expect.arrayContaining([
      10.5, 5.6000000000000005,
    ]));
  });

  it('does not draw a second progress bar above a washing janitor', () => {
    const ctx = recordCtx();
    drawStaffLayer(ctx, {
      restaurant: { gameTime: 30 },
      serviceItems: [],
      staff: [{ id: 'm', name: 'M', role: 'janitor', x: 300, y: 100,
        task: { type: 'wash_item', washingStartedAt: 0 } }],
    }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.rects.filter(r => r.w === 1 && r.h > 0 && r.h <= 14)).toHaveLength(0);
    expect(ctx._calls.arcs.length).toBeGreaterThan(0); // character still renders
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

  it.each(['checkout_queued', 'checkout_moving', 'checkout_processing'])
    ('renders a combined delivered order for a customer in %s', stateName => {
      const ctx = recordCtx();
      const table = { id: 't1', x: 200, y: 200 };
      const chair = { id: 'ch1', tableId: 't1', x: 210, y: 180 };
      const positions = getPlaceSettingPositions(table, chair, ['dish', 'drink']);
      drawFurnitureLayer(ctx, {
        tables: [table], chairs: [chair], kitchenStations: [], serviceTables: [], equipment: [],
        customers: [{ id: 'c1', state: stateName, tableId: 't1', chairId: 'ch1' }],
        dishes: [{ id: 'toast', base: 'Bread' }],
        serviceItems: [
          { id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered', x: 0, y: 0 },
          { id: 'drink', customerId: 'c1', kind: 'drink', menuItemId: 'water', state: 'delivered', x: 0, y: 0 },
        ],
      }, { x: 0, y: 0, zoom: 1 });
      expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '🍞', ...positions.dish }));
      expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '💧', ...positions.drink }));
    });

  it('keeps delivered and dirty items at stable combined place settings', () => {
    const table = { id: 't1', x: 200, y: 200 };
    const chair = { id: 'ch1', tableId: 't1', x: 210, y: 180 };
    const positions = getPlaceSettingPositions(table, chair, ['dish', 'drink']);
    const state = {
      tables: [table], chairs: [chair], kitchenStations: [], serviceTables: [], equipment: [],
      customers: [{ id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1' }],
      dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered', x: 0, y: 0 },
        { id: 'drink', customerId: 'c1', kind: 'drink', menuItemId: 'water', state: 'dirty_at_table', x: 0, y: 0 },
      ],
    };
    const partiallyConsumed = recordCtx();
    drawFurnitureLayer(partiallyConsumed, state, { x: 0, y: 0, zoom: 1 });
    expect(partiallyConsumed._calls.texts).toContainEqual(expect.objectContaining({ text: '🍞', ...positions.dish }));
    expect(partiallyConsumed._calls.texts).toContainEqual(expect.objectContaining({ text: '🥛', ...positions.drink }));

    const fullyConsumed = recordCtx();
    drawFurnitureLayer(fullyConsumed, {
      ...state,
      serviceItems: state.serviceItems.map(item => item.kind === 'dish'
        ? { ...item, state: 'dirty_at_table', consumedAt: 480, dirtyAt: 480 }
        : item),
    }, { x: 0, y: 0, zoom: 1 });
    expect(fullyConsumed._calls.texts).toContainEqual(expect.objectContaining({ text: '🍽️', ...positions.dish }));
    expect(fullyConsumed._calls.texts).toContainEqual(expect.objectContaining({ text: '🥛', ...positions.drink }));
  });

  it('centres delivered food and drink glyphs on their inset table positions', () => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables: [{ id: 't1', x: 200, y: 200 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }],
      customers: [{ id: 'c1', tableId: 't1', chairId: 'ch1' }],
      kitchenStations: [], serviceTables: [], equipment: [], dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [
        { id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered', x: 0, y: 0 },
        { id: 'drink', customerId: 'c1', kind: 'drink', menuItemId: 'water', state: 'delivered', x: 0, y: 0 },
      ],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({
      text: '🍞', x: 226, y: 208, textAlign: 'center', textBaseline: 'middle',
    }));
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({
      text: '💧', x: 214, y: 208, textAlign: 'center', textBaseline: 'middle',
    }));
  });

  it.each([
    ['dish', 'toast', '🍞'],
    ['drink', 'water', '💧'],
  ])('uses the single-item %s place setting', (kind, menuItemId, emoji) => {
    const ctx = recordCtx();
    const table = { id: 't1', x: 200, y: 200 };
    const chair = { id: 'ch1', tableId: 't1', x: 210, y: 180 };
    const expected = getPlaceSettingPositions(table, chair, [kind])[kind];
    drawFurnitureLayer(ctx, {
      tables: [table], chairs: [chair], kitchenStations: [], serviceTables: [], equipment: [],
      customers: [{ id: 'c1', state: 'eating', tableId: 't1', chairId: 'ch1' }],
      dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [{ id: kind, customerId: 'c1', kind, menuItemId, state: 'delivered', x: 9, y: 9 }],
    }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: emoji, ...expected }));
  });

  it('places delivered items by their owning customers at a shared table', () => {
    const ctx = recordCtx();
    const table = { id: 't1', x: 200, y: 200 };
    const chairs = [
      { id: 'north', tableId: 't1', x: 210, y: 180 },
      { id: 'south', tableId: 't1', x: 210, y: 240 },
    ];
    const expected = chairs.map(chair => getPlaceSettingPositions(table, chair, ['dish']).dish);
    drawFurnitureLayer(ctx, {
      tables: [table], chairs, kitchenStations: [], serviceTables: [], equipment: [],
      customers: [
        { id: 'c1', tableId: 't1', chairId: 'north' },
        { id: 'c2', tableId: 't1', chairId: 'south' },
      ],
      dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [
        { id: 'one', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered', x: 0, y: 0 },
        { id: 'two', customerId: 'c2', kind: 'dish', menuItemId: 'toast', state: 'delivered', x: 0, y: 0 },
      ],
    }, { x: 0, y: 0, zoom: 1 });
    for (const position of expected) {
      expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '🍞', ...position }));
    }
  });

  it.each([
    ['customer', [], [{ id: 'ch1', tableId: 't1', x: 210, y: 180 }], [{ id: 't1', x: 200, y: 200 }]],
    ['chair', [{ id: 'c1', tableId: 't1', chairId: 'missing' }], [], [{ id: 't1', x: 200, y: 200 }]],
    ['table', [{ id: 'c1', tableId: 'missing', chairId: 'ch1' }], [{ id: 'ch1', tableId: 'missing', x: 210, y: 180 }], []],
  ])('does not draw a delivered item with a missing %s reference', (_name, customers, chairs, tables) => {
    const ctx = recordCtx();
    drawFurnitureLayer(ctx, {
      tables, chairs, customers, kitchenStations: [], serviceTables: [], equipment: [],
      dishes: [{ id: 'toast', base: 'Bread' }],
      serviceItems: [{ id: 'dish', customerId: 'c1', kind: 'dish', menuItemId: 'toast', state: 'delivered', x: 9, y: 9 }],
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
      staff: [{ id: 'cook', name: 'Cook', role: 'cook', morale: 80, x: 80, y: 120,
        task: { type: 'prepare_dish', serviceItemId: 'food', stationId: 'k1' } }],
      serviceItems: [{ id: 'food', kind: 'dish', menuItemId: 'dish', customerId: 'customer', state: 'ordered' }],
    };
    const preparing = updateStaff(state, 0);
    expect(preparing.staff[0].task).toMatchObject({ type: 'prepare_dish', serviceItemId: 'food' });
    expect(preparing.serviceItems[0]).toMatchObject({ state: 'preparing', preparationStartedAt: 100 });
    const ctx = recordCtx();
    drawStaffLayer(ctx, { ...preparing, restaurant: { gameTime: 130 } }, { x: 0, y: 0, zoom: 1 });
    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ w: 1, h: 4.8999999999999995 }));

    const completed = processKitchen({ ...preparing, restaurant: { gameTime: 160 } });
    expect(completed.staff[0].task).toMatchObject({ type: 'prepare_dish', serviceItemId: 'food' });
    expect(completed.serviceItems[0]).toMatchObject({ state: 'ready', x: 120, y: 120 });
  });

  it('labels empty kitchen stations and preserves the installed equipment name', () => {
    const ctx = recordCtx();

    drawFurnitureLayer(ctx, {
      tables: [], chairs: [], kitchenStations: [
        { id: 'empty', x: 100, y: 120, equipmentId: null },
        { id: 'toaster', x: 160, y: 120, equipmentId: 'eq1' },
      ], serviceTables: [], equipment: [{ id: 'eq1', name: 'Toaster' }], dishes: [], serviceItems: [],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts.map(call => call.text)).toEqual(expect.arrayContaining([
      'Kitchen', 'station', 'Toaster',
    ]));
    expect(ctx._calls.texts.map(call => call.text)).not.toContain('Kitchen equipment');
  });
});

describe('drawPlacementPreview', () => {
  it('labels an equipment-station preview with the selected equipment name', () => {
    const ctx = recordCtx();

    drawPlacementPreview(ctx, {
      equipment: [{ id: 'eq2', name: 'Oven' }],
    }, { x: 0, y: 0, zoom: 1 }, {
      itemType: 'equipmentStation', equipmentId: 'eq2',
      x: 500, y: 120, rotation: 0, valid: true,
    });

    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({
      text: 'Oven', x: 520, y: 140,
    }));
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

  it('renders morale-scaled accumulated work instead of reusing the legacy timestamp formula', () => {
    const ctx = recordCtx();
    drawStaffLayer(ctx, {
      restaurant: { expansionLevel: 1, gameTime: 40 },
      serviceItems: [{ id: 'food', kind: 'dish', menuItemId: 'dish', state: 'preparing',
        preparationStartedAt: 0, accumulatedWork: 0, lastProgressAt: 0 }],
      dishes: [{ id: 'dish', prepTime: 60 }],
      kitchenStations: [{ id: 'k1' }], equipment: [],
      staff: [{ id: 'cook', name: 'Cook', role: 'cook', morale: 0, x: 100, y: 100,
        task: { type: 'prepare_dish', serviceItemId: 'food', stationId: 'k1' } }],
    }, camera);

    expect(ctx._calls.rects).toContainEqual(expect.objectContaining({ w: 1, h: 9.333333333333334 }));
  });

  it('uses dynamic s.x/s.y when both are finite', () => {
    const staff = [
      { id: 's1', name: 'Marco', role: 'cook', x: 150, y: 200, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    expect(ctx._calls.arcs[0].x).toBe(150);
    expect(ctx._calls.arcs[0].y).toBe(196);
  });

  it('renders staff as a stick figure with arms and hands', () => {
    const state = {
      staff: [{ id: 's1', name: 'Marco', role: 'cook', x: 150, y: 200, morale: 80 }],
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();

    drawStaffLayer(ctx, state, camera);

    expect(ctx._calls.lines.length).toBeGreaterThanOrEqual(5);
    expect(ctx._calls.rects).toContainEqual({ x: 141, y: 206, w: 2, h: 2 });
    expect(ctx._calls.rects).toContainEqual({ x: 157, y: 206, w: 2, h: 2 });
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

  it('changes the limb pose while traversing and keeps a held nonempty goal still', () => {
    const goal = { x: 350, y: 200 };
    const moving = withMovementStatuses({
      staff: [{ id: 's1', name: 'Marco', gender: 'male', role: 'cook', x: 150, y: 200, morale: 80, navigationGoal: goal }],
      restaurant: { expansionLevel: 1 },
    }, {
      s1: { goal, status: { plan: 'scheduled', motion: 'traversing' } },
    });
    const idle = withMovementStatuses({
      ...moving,
      staff: [{ ...moving.staff[0] }],
    }, {
      s1: { goal, status: { plan: 'scheduled', motion: 'holding' } },
    });
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
      expect.objectContaining({ text: 'Sofia', x: 200, y: 182 }),
      expect.objectContaining({ text: 'Anna', x: 202, y: 172 }),
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
    // getDefaultStaffPosition for cook index 0 at expansionLevel 1: world.floorX=50
    // x = 50 + 40 + 0*45 = 90, y = world.diningY = 100
    expect(ctx._calls.arcs[0].x).toBe(90);
    expect(ctx._calls.arcs[0].y).toBe(96);
  });

  it('falls back when x is not finite', () => {
    const staff = [
      { id: 's1', name: 'Marco', role: 'cook', x: NaN, y: 200, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    expect(ctx._calls.arcs[0].x).toBe(90);
    expect(ctx._calls.arcs[0].y).toBe(96);
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

    expect(ctx._calls.arcs[0]).toMatchObject({ x: 840, y: 96 });
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
        activityPhase: 'working', task: { type: 'clean_table', tableId: 't1' },
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

  it('cleans only while a cleaning task is working and movement is holding', () => {
    const goal = { x: 340, y: 300 };
    const baseStaff = {
      id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80,
      activityPhase: 'working', task: { type: 'clean_table', tableId: 't1' },
    };
    const working = {
      staff: [baseStaff], restaurant: { expansionLevel: 1 },
    };
    const assigned = {
      staff: [{ ...baseStaff, activityPhase: 'task_assigned' }], restaurant: { expansionLevel: 1 },
    };
    const traversing = withMovementStatuses({
      staff: [{ ...baseStaff, navigationGoal: goal }], restaurant: { expansionLevel: 1 },
    }, {
      s1: { goal, status: { plan: 'scheduled', motion: 'traversing' } },
    });
    const workingCtx = recordCtx();
    const assignedCtx = recordCtx();
    const traversingCtx = recordCtx();

    drawStaffLayer(workingCtx, working, camera, { timeMs: 0 });
    drawStaffLayer(assignedCtx, assigned, camera, { timeMs: 0 });
    drawStaffLayer(traversingCtx, traversing, camera, { timeMs: 0 });

    expect(workingCtx._calls.strokes).toContainEqual({ colour: '#f3e6bd' });
    expect(assignedCtx._calls.strokes).not.toContainEqual({ colour: '#f3e6bd' });
    expect(traversingCtx._calls.strokes).not.toContainEqual({ colour: '#f3e6bd' });
  });

  it.each(['planning', 'scheduled'])('suppresses work progress while a goal is %s', plan => {
    const goal = { x: 340, y: 300 };
    const state = withMovementStatuses({
      staff: [{
        id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80,
        navigationGoal: goal, task: { type: 'take_order', startedAt: 0 },
      }],
      restaurant: { expansionLevel: 1, gameTime: 30 },
    }, {
      s1: { goal, status: { plan, motion: 'holding' } },
    });
    const ctx = recordCtx();

    drawStaffLayer(ctx, state, camera);

    expect(ctx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toHaveLength(0);
  });

  it('restores work progress after arrival, including a cleared goal', () => {
    const goal = { x: 340, y: 300 };
    const staff = {
      id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80,
      task: { type: 'take_order', startedAt: 0 },
    };
    const arrived = withMovementStatuses({
      staff: [{ ...staff, navigationGoal: goal }],
      restaurant: { expansionLevel: 1, gameTime: 30 },
    }, {
      s1: { goal, status: { plan: 'arrived', motion: 'holding' } },
    });
    const cleared = {
      staff: [staff],
      restaurant: { expansionLevel: 1, gameTime: 30 },
    };
    const arrivedCtx = recordCtx();
    const clearedCtx = recordCtx();

    drawStaffLayer(arrivedCtx, arrived, camera);
    drawStaffLayer(clearedCtx, cleared, camera);

    expect(arrivedCtx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toHaveLength(1);
    expect(clearedCtx._calls.rects.filter(rect => rect.w === 1 && rect.h > 0 && rect.h <= 14))
      .toHaveLength(1);
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
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({
      text: '🍞', font: "400 12px 'Segoe UI', system-ui, sans-serif",
    }));
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
        { id: 'fade', state: 'leaving', exitPhase: 'fading', exitFadeProgress: 0.4, x: 500, y: 300 },
        { id: 'solid', state: 'entering', x: 700, y: 350 },
      ], tables: [], chairs: [], restaurant: {},
    };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera, { timeMs: 200, reducedMotion: true });
    expect(ctx._calls.arcs).toEqual(expect.arrayContaining([
      expect.objectContaining({ x: 500, y: 296, alpha: 0.6 }),
      expect.objectContaining({ x: 700, y: 346, alpha: 1 }),
    ]));
    expect(ctx._calls.saves).toBe(5);
    expect(ctx._calls.restores).toBe(5);
    expect(ctx._calls.lines).toEqual(expect.any(Array));
  });

  it('suppresses fading limb animation in reduced motion at every time', () => {
    const state = {
      customers: [{ id: 'fade', state: 'leaving', exitPhase: 'fading', exitFadeProgress: 0.4, x: 500, y: 300 }],
      tables: [], chairs: [], restaurant: {},
    };
    const first = recordCtx();
    const second = recordCtx();
    drawCustomerLayer(first, state, camera, { timeMs: 0, reducedMotion: true });
    drawCustomerLayer(second, state, camera, { timeMs: 200, reducedMotion: true });
    expect(first._calls.lines).toEqual(second._calls.lines);
    expect(first._calls.arcs[0]).toMatchObject({ x: 500, y: 296, alpha: 0.6 });
    expect(second._calls.arcs[0]).toMatchObject({ x: 500, y: 296, alpha: 0.6 });
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

  it.each(['leaving', 'checkout_queued', 'checkout_moving'])(
    'keeps a %s customer seated visually until they physically leave the chair', stateName => {
      const chair = { id: 'ch1', tableId: 't1', x: 350, y: 320 };
      const table = { id: 't1', x: 340, y: 340 };
      let customer = {
        id: 'c1', partyId: 'p1', state: stateName, chairId: chair.id, tableId: table.id,
        x: 360, y: 330, menuOutcome: stateName === 'leaving' ? 'unaffordable' : 'ordered',
      };
      customer = { ...customer, ...recordSeatResidency(customer, chair, table) };
      const state = { customers: [customer], chairs: [chair], tables: [table] };
      const waiting = recordCtx();
      drawCustomerLayer(waiting, state, camera);
      expect(waiting._calls.arcs[0]).toMatchObject({ x: 360, y: 325 });
      expect(waiting._calls.lines.every(point => point.y < table.y)).toBe(true);

      const departed = recordCtx();
      drawCustomerLayer(departed, {
        ...state,
        customers: [{ ...customer, x: 360, y: 300 }],
      }, camera);
      expect(departed._calls.arcs[0]).toMatchObject({ x: 360, y: 296 });
      expect(departed._calls.lines).toContainEqual({ x: 366, y: 318 });
    },
  );

  it('fits an upright deciding customer into its chair and centres its menu beneath it', () => {
    const ctx = recordCtx();
    drawCustomerLayer(ctx, {
      customers: [{ id: 'c1', state: 'seated', chairId: 'ch1', tableId: 't1', x: 800, y: 400 }],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 100 }],
      tables: [{ id: 't1', x: 140, y: 90 }],
    }, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.arcs).toContainEqual(expect.objectContaining({ x: 110, y: 105 }));
    expect(ctx._calls.rects).toContainEqual({ x: 98, y: 112, w: 24, h: 16 });
    expect(ctx._calls.rotations.at(-1)).toBe(0);
  });

  it.each([
    ['seated', { state: 'seated', dishId: null }, { x: 110, y: 105 }],
    ['ordering', { state: 'ordering', dishId: 'dish' }, { x: 110, y: 105 }],
    ['eating', { state: 'eating', dishId: 'dish' }, { x: 110, y: 105 }],
    ['waiting_for_items', { state: 'waiting_for_items', dishId: 'dish' }, { x: 110, y: 105 }],
    ['waiting_for_party', { state: 'waiting_for_party', menuOutcome: 'unaffordable', dishId: null }, { x: 110, y: 105 }],
    ['moving', { state: 'entering' }, { x: 800, y: 396 }],
    ['paying', { state: 'paying' }, { x: 800, y: 396 }],
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
      { id: 'c1', archetype: 'regular', state: 'entering', x: 850, y: 370 },
    ];
    const state = { customers, tables: [], restaurant: {} };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    expect(ctx._calls.arcs[0].x).toBe(850);
    expect(ctx._calls.arcs[0].y).toBe(366);
  });

  it('animates a guided customer only while public movement status is traversing', () => {
    const goal = { x: 950, y: 370 };
    const traversing = withMovementStatuses({
      customers: [{ id: 'c1', state: 'entering', x: 850, y: 370, navigationGoal: goal }],
      tables: [], restaurant: {},
    }, {
      c1: { goal, status: { plan: 'scheduled', motion: 'traversing' } },
    });
    const holding = withMovementStatuses({
      customers: [{ id: 'c1', state: 'entering', x: 850, y: 370, navigationGoal: goal }],
      tables: [], restaurant: {},
    }, {
      c1: { goal, status: { plan: 'scheduled', motion: 'holding' } },
    });
    const traversingStart = recordCtx();
    const traversingLater = recordCtx();
    const holdingStart = recordCtx();
    const holdingLater = recordCtx();

    drawCustomerLayer(traversingStart, traversing, camera, { timeMs: 0 });
    drawCustomerLayer(traversingLater, traversing, camera, { timeMs: 200 });
    drawCustomerLayer(holdingStart, holding, camera, { timeMs: 0 });
    drawCustomerLayer(holdingLater, holding, camera, { timeMs: 200 });

    expect(traversingStart._calls.lines).not.toEqual(traversingLater._calls.lines);
    expect(holdingStart._calls.lines).toEqual(holdingLater._calls.lines);
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
      { id: 'c1', archetype: 'regular', state: 'entering', x: 850, y: 370, tableId: 't1' },
    ];
    const tables = [{ id: 't1', x: 200, y: 200, status: 'reserved', seats: 2 }];
    const state = { customers, tables, restaurant: {} };
    const ctx = recordCtx();
    drawCustomerLayer(ctx, state, camera);
    expect(ctx._calls.arcs.length).toBe(1);
    // should use dynamic x/y, not table position
    expect(ctx._calls.arcs[0].x).toBe(850);
    expect(ctx._calls.arcs[0].y).toBe(366);
  });

  it('animates a fading customer only while movement status is traversing', () => {
    const goal = { x: 620, y: 300 };
    const holding = withMovementStatuses({
      customers: [{
        id: 'c1', gender: 'male', state: 'leaving', exitPhase: 'fading',
        exitFadeProgress: 0.2, x: 500, y: 300, navigationGoal: goal,
      }],
      tables: [], chairs: [], restaurant: {},
    }, {
      c1: { goal, status: { plan: 'scheduled', motion: 'holding' } },
    });
    const traversing = withMovementStatuses({
      customers: [{
        id: 'c1', gender: 'male', state: 'leaving', exitPhase: 'fading',
        exitFadeProgress: 0.2, x: 500, y: 300, navigationGoal: goal,
      }],
      tables: [], chairs: [], restaurant: {},
    }, {
      c1: { goal, status: { plan: 'scheduled', motion: 'traversing' } },
    });
    const start = recordCtx();
    const later = recordCtx();
    const movingStart = recordCtx();
    const movingLater = recordCtx();
    const reducedStart = recordCtx();
    const reducedLater = recordCtx();

    drawCustomerLayer(start, holding, camera, { timeMs: 0, reducedMotion: false });
    drawCustomerLayer(later, holding, camera, { timeMs: 200, reducedMotion: false });
    drawCustomerLayer(movingStart, traversing, camera, { timeMs: 0, reducedMotion: false });
    drawCustomerLayer(movingLater, traversing, camera, { timeMs: 200, reducedMotion: false });
    drawCustomerLayer(reducedStart, traversing, camera, { timeMs: 0, reducedMotion: true });
    drawCustomerLayer(reducedLater, traversing, camera, { timeMs: 200, reducedMotion: true });

    expect(start._calls.lines).toEqual(later._calls.lines);
    expect(movingStart._calls.lines).not.toEqual(movingLater._calls.lines);
    expect(reducedStart._calls.lines).toEqual(reducedLater._calls.lines);
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

    expect(ctx._calls.arcs[0]).toMatchObject({ x: 780, y: 136 });
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
  it('renders the exact leased customer positions and counts members hidden without a lease', () => {
    const members = Array.from({ length: 9 }, (_, partyIndex) =>
      Array.from({ length: 4 }, (_, memberIndex) => ({
        id: `p${partyIndex}-m${memberIndex}`,
        partyId: `p${partyIndex}`,
        gender: memberIndex % 2 ? 'female' : 'male',
      })));
    const state = {
      queue: members.map((partyMembers, partyIndex) => ({
        partyId: `p${partyIndex}`,
        members: partyMembers,
      })),
      // The FIFO front of the queue owns exact level-1 leases (the first nine
      // logical members); the remaining members are hidden logical records.
      queueSlots: members.flat().slice(0, 9).map((member, index) => ({
        memberId: member.id,
        partyId: member.partyId,
        x: 973,
        y: 390 + index * 30,
        slot: index,
      })),
      restaurant: { expansionLevel: 1 },
    };
    const ctx = recordCtx();

    drawQueueLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.arcs).toHaveLength(9);
    expect(ctx._calls.arcs.map(({ x }) => x)).toEqual(Array(9).fill(973));
    expect(ctx._calls.arcs.map(({ y }) => y)).toEqual([386, 416, 446, 476, 506, 536, 566, 596, 626]);
    expect(ctx._calls.texts).toContainEqual(expect.objectContaining({ text: '+27', y: 660 }));
  });
});
