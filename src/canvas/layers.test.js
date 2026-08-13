import { describe, expect, it } from 'vitest';
import { drawOverlayLayer, drawStaffLayer, drawCustomerLayer, drawFloorLayer, drawFurnitureLayer } from './layers';

function recordCtx(extraCanvas = {}) {
  const calls = { arcs: [], texts: [], rects: [], fills: [], moves: [], lines: [], strokes: [] };
  return {
    canvas: { height: 600, width: 800, ...extraCanvas },
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    measureText: (text) => ({ width: String(text).length }),
    beginPath: () => {},
    moveTo: (x, y) => calls.moves.push({ x, y }),
    lineTo: (x, y) => calls.lines.push({ x, y }),
    stroke() { calls.strokes.push({ colour: this.strokeStyle }); },
    fillStyle: '',
    font: '',
    lineWidth: 1,
    arc: (x, y, r, start, end) => calls.arcs.push({ x, y, r, start, end }),
    fill: () => calls.fills.push({}),
    fillRect: (x, y, w, h) => calls.rects.push({ x, y, w, h }),
    fillText: (text, x, y) => calls.texts.push({ text, x, y }),
    strokeRect: () => {},
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
  it('labels every dining table and keeps its name above the customer marker', () => {
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
      chairs: [], kitchenStations: [], serviceTables: [], foodItems: [], equipment: [], dishes: [],
    };

    drawFurnitureLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts.map(call => call.text)).toEqual(['Table 1', 'Table 2', 'Table 3']);
    expect(ctx._calls.texts.map(call => call.x)).toEqual([102, 202, 302]);
    expect(ctx._calls.texts.map(call => call.y)).toEqual([110, 110, 110]);
    expect(ctx._calls.texts[0]).toMatchObject({ colour: '#fff', font: 'bold 10px monospace' });
  });

  it('shows an arrow for a chair direction', () => {
    const ctx = recordCtx();
    const state = {
      tables: [],
      chairs: [{ id: 'ch1', tableId: 't1', x: 100, y: 120, rotation: 1 }],
      kitchenStations: [],
      serviceTables: [],
      foodItems: [],
      equipment: [],
      dishes: [],
    };

    drawFurnitureLayer(ctx, state, { x: 0, y: 0, zoom: 1 });

    expect(ctx._calls.texts).toContainEqual({ text: '→', x: 110, y: 130 });
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
      { text: 'Sofia', x: 200, y: 186 },
      { text: 'Anna', x: 202, y: 176 },
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

  it('shows task label when s.task.type exists', () => {
    const staff = [
      { id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80, task: { type: 'take_order', customerId: 'c1' } },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    const taskTexts = ctx._calls.texts.filter(t => t.text && t.text.includes('take_order'));
    expect(taskTexts.length).toBe(1);
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

  it('shows carried-food marker when s.carryingFoodId is set', () => {
    const staff = [
      { id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80, carryingFoodId: 'f1' },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    // carried-food marker should be a small rect or text near the staff
    const foodMarkers = ctx._calls.texts.filter(t => String(t.text).includes('F'));
    expect(foodMarkers.length).toBe(1);
  });

  it('does not show carried-food marker when not carrying', () => {
    const staff = [
      { id: 's1', name: 'Anna', role: 'waiter', x: 300, y: 300, morale: 80 },
    ];
    const state = { staff, restaurant: { expansionLevel: 1 } };
    const ctx = recordCtx();
    drawStaffLayer(ctx, state, camera);
    const foodMarkers = ctx._calls.texts.filter(t => String(t.text).includes('F'));
    expect(foodMarkers.length).toBe(0);
  });
});

describe('drawCustomerLayer', () => {
  const camera = { x: 0, y: 0, zoom: 1 };

  it('renders guided customer at dynamic x/y even without tableId', () => {
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'guided', x: 850, y: 370, guideHostId: 'h1' },
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
    expect(ctx._calls.arcs[0].y).toBe(190);
  });

  it('shows a menu held by a seated customer who is deciding', () => {
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'seated', tableId: 't1', dishId: null },
    ];
    const tables = [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }];
    const state = { customers, tables, restaurant: {} };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.lines.length).toBeGreaterThanOrEqual(5);
    expect(ctx._calls.rects).toContainEqual({ x: 211, y: 223, w: 18, h: 12 });
  });

  it('keeps the menu visible while a customer is ordering', () => {
    const state = {
      customers: [{ id: 'c1', archetype: 'regular', gender: 'female', state: 'ordering', tableId: 't1', dishId: 'd1' }],
      tables: [{ id: 't1', x: 200, y: 200, status: 'occupied', seats: 2 }],
      restaurant: {},
    };
    const ctx = recordCtx();

    drawCustomerLayer(ctx, state, camera);

    expect(ctx._calls.rects).toContainEqual({ x: 211, y: 223, w: 18, h: 12 });
    expect(ctx._calls.strokes).toContainEqual({ colour: '#e66a9c' });
  });

  it('renders guided customer by x/y even when tableId is also set', () => {
    // guided customer has tableId assigned but hasn't been seated yet
    const customers = [
      { id: 'c1', archetype: 'regular', state: 'guided', x: 850, y: 370, tableId: 't1', guideHostId: 'h1' },
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
