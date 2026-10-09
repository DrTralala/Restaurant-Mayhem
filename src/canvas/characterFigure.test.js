import { describe, expect, it, vi } from 'vitest';
import { drawStickFigure } from './characterFigure';

const ACTIVITIES = Object.freeze([
  'idle', 'waiting', 'impatient', 'walking', 'carrying', 'reading', 'eating',
  'drinking', 'paying', 'taking_order', 'taking_payment', 'preparing',
  'toasting', 'baking', 'frying', 'blending', 'making_coffee', 'dispensing',
  'pickup', 'serving', 'collecting', 'depositing', 'wiping', 'sweeping',
  'washing', 'resting', 'sleeping', 'gaming',
]);

const GESTURES = Object.freeze(['pickup', 'serving', 'collecting', 'depositing']);
const WATER_COLOUR = '#bfe0ff';

function makeRecordingContext() {
  const ops = [];
  const ctx = {
    canvas: { width: 1000, height: 700 },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    save: vi.fn(() => ops.push({ op: 'save' })),
    restore: vi.fn(() => ops.push({ op: 'restore' })),
    translate: vi.fn((x, y) => ops.push({ op: 'translate', x, y })),
    rotate: vi.fn(angle => ops.push({ op: 'rotate', angle })),
    scale: vi.fn((x, y) => ops.push({ op: 'scale', x, y })),
    beginPath: vi.fn(() => ops.push({ op: 'beginPath' })),
    moveTo: vi.fn((x, y) => ops.push({
      op: 'moveTo', x, y, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
    })),
    lineTo: vi.fn((x, y) => ops.push({
      op: 'lineTo', x, y, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
    })),
    arc: vi.fn((x, y, radius) => ops.push({
      op: 'arc', x, y, radius, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
    })),
    stroke: vi.fn(() => ops.push({ op: 'stroke' })),
    fill: vi.fn(() => ops.push({ op: 'fill' })),
    fillRect: vi.fn((x, y, w, h) => ops.push({
      op: 'fillRect', x, y, w, h, fillStyle: ctx.fillStyle,
    })),
    strokeRect: vi.fn((x, y, w, h) => ops.push({
      op: 'strokeRect', x, y, w, h, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth,
    })),
    fillText: vi.fn((text, x, y) => ops.push({
      op: 'fillText', text, x, y, font: ctx.font, fillStyle: ctx.fillStyle,
    })),
    measureText: vi.fn(text => ({ width: String(text).length * 5 })),
  };
  ctx._ops = ops;
  return ctx;
}

function record(fn, options, point = {}) {
  const ctx = makeRecordingContext();
  const { x = 20, y = 30, color = '#fff' } = point;
  fn(ctx, x, y, color, options);
  return ctx;
}

const draw = (options, point) => record(drawStickFigure, options, point);
const drawLegacy = (options, point) => record(legacyDrawStickFigure, options, point);

function geometries(ops) {
  return ops.filter(op => ['moveTo', 'lineTo', 'arc', 'fillRect', 'strokeRect'].includes(op.op));
}

function maxCoordinate(ops, axis) {
  return Math.max(...geometries(ops).map(op => op[axis]));
}

function hasStrokeRect(ops) {
  return ops.some(op => op.op === 'strokeRect');
}

function fillTexts(ctx) {
  return ctx._ops.filter(op => op.op === 'fillText');
}

// Frozen Canvas-operation expectations from `git show c3cc0d4:src/canvas/layers.js`.
const legacyLine = (op, x, y, strokeStyle = '#fff', lineWidth = 2) => ({
  op, x, y, strokeStyle, lineWidth,
});
const legacyHead = { op: 'arc', x: 0, y: 0, radius: 4, strokeStyle: '#fff', lineWidth: 2 };
const legacyStanding = [
  legacyHead,
  legacyLine('moveTo', 0, 4), legacyLine('lineTo', 0, 14),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', -8, 10),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', 8, 10),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', -6, 22),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', 6, 22),
];
const legacySeated = [
  legacyHead,
  legacyLine('moveTo', 0, 4), legacyLine('lineTo', 0, 14),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', -8, 10),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', 8, 10),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', -6, 15),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', 6, 15),
];
const legacyLying = [
  legacyHead,
  legacyLine('moveTo', 4, 0), legacyLine('lineTo', 16, 0),
  legacyLine('moveTo', 8, -3), legacyLine('lineTo', 8, 5),
  legacyLine('moveTo', 16, 0), legacyLine('lineTo', 23, -5),
  legacyLine('moveTo', 16, 0), legacyLine('lineTo', 23, 5),
];
const legacyWalking = [
  legacyHead,
  legacyLine('moveTo', 0, 4), legacyLine('lineTo', 0, 14),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', -8, 14),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', 8, 6),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', -6, 18),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', 6, 26),
];
const legacyCleaning = [
  legacyHead,
  legacyLine('moveTo', 0, 4), legacyLine('lineTo', 0, 14),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', 8, 12),
  legacyLine('moveTo', 0, 7), legacyLine('lineTo', 14, 12),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', -6, 22),
  legacyLine('moveTo', 0, 14), legacyLine('lineTo', 6, 22),
  legacyLine('moveTo', 7, 15, '#f3e6bd', 3),
  legacyLine('lineTo', 16, 15, '#f3e6bd', 3),
];
const legacyCanvasGeometry = ctx => ctx._ops.filter(op => (
  ['arc', 'moveTo', 'lineTo', 'fillRect', 'strokeRect'].includes(op.op)
));

describe('characterFigure activity poses', () => {
  describe.each(ACTIVITIES)('%s', activity => {
    it('keeps the authored anchor transform and balances save/restore', () => {
      const ctx = draw({ activity, timeMs: 500, id: 'actor' });

      expect(ctx.translate).toHaveBeenCalledWith(20, 30);
      expect(ctx._ops.filter(op => op.op === 'translate')).toEqual([
        { op: 'translate', x: 20, y: 30 },
      ]);
      expect(ctx._ops[0]).toEqual({ op: 'save' });
      expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.arc).toHaveBeenCalled();
    });

    it('animates between two normal-motion timestamps', () => {
      const early = draw({ activity, timeMs: 0 });
      const later = draw({ activity, timeMs: 270 });

      expect(early._ops).not.toEqual(later._ops);
    });

    it('is time invariant under reduced motion', () => {
      const early = draw({ activity, timeMs: 0, id: 'actor', reducedMotion: true });
      const later = draw({ activity, timeMs: 9300, id: 'actor', reducedMotion: true });

      expect(early._ops).toEqual(later._ops);
      expect(early.arc).toHaveBeenCalled();
    });

    it('never draws an inventory glyph as a prop', () => {
      const ctx = draw({ activity, timeMs: 120, id: 'actor' });

      for (const op of fillTexts(ctx)) {
        expect(op.text).toMatch(/^z+$/i);
      }
    });

    it('keeps every drawn coordinate finite', () => {
      const ctx = draw({ activity, timeMs: 130, id: 'actor' });

      for (const op of geometries(ctx._ops)) {
        for (const axis of ['x', 'y', 'w', 'h', 'radius']) {
          if (axis in op) {
            expect(Number.isFinite(op[axis]), `${activity} ${op.op} ${axis}`).toBe(true);
          }
        }
      }
    });
  });
});

describe('characterFigure legacy compatibility', () => {
  it.each([
    ['plain standing', {}, legacyStanding, 0, 1],
    ['walking at peak stride', { walking: true, timeMs: Math.PI / 0.024, id: '' }, legacyWalking, 0, 1],
    ['cleaning at peak wipe', { cleaning: true, timeMs: Math.PI / 0.024, id: '' }, legacyCleaning, 0, 1],
    ['seated', { seated: true }, legacySeated, 0, 1],
    ['lying', { lying: true }, legacyLying, 0, 1],
    ['reduced-motion walking', { walking: true, reducedMotion: true, timeMs: 900 }, legacyStanding, 0, 1],
    ['scaled and rotated', { scale: 0.7, rotation: 1.2, timeMs: 130, id: 'abc' }, legacyStanding, 1.2, 0.7],
    ['explicit undefined activity', { activity: undefined, walking: true, timeMs: 0, id: '' }, legacyStanding, 0, 1],
    ['empty activity string', { activity: '', walking: true, timeMs: 0, id: '' }, legacyStanding, 0, 1],
  ])('matches pinned c3cc0d4 Canvas-operation fixture for %s', (_label, options, expected, rotation, scale) => {
    const ctx = draw(options);

    expect(legacyCanvasGeometry(ctx)).toEqual(expected);
    expect(ctx._ops.filter(op => ['translate', 'rotate', 'scale'].includes(op.op))).toEqual([
      { op: 'translate', x: 20, y: 30 },
      { op: 'rotate', angle: rotation },
      { op: 'scale', x: scale, y: scale },
    ]);
  });

  it('draws the plain figure when no options are supplied', () => {
    const ctx = makeRecordingContext();

    expect(() => drawStickFigure(ctx, 20, 30, '#fff')).not.toThrow();
    expect(ctx.translate).toHaveBeenCalledWith(20, 30);
    expect(ctx.arc).toHaveBeenCalled();
  });
});

describe('characterFigure pose readability', () => {
  it('distinguishes eating from drinking', () => {
    const eating = draw({ activity: 'eating', timeMs: 180 })._ops;
    const drinking = draw({ activity: 'drinking', timeMs: 180 })._ops;

    expect(eating).not.toEqual(drinking);
    expect(hasStrokeRect(drinking)).toBe(true);
    expect(hasStrokeRect(eating)).toBe(false);
  });

  it('draws a notepad and pencil for taking_order', () => {
    const ops = draw({ activity: 'taking_order', timeMs: 150 })._ops;

    expect(ops.some(op => op.op === 'fillRect')).toBe(true);
    expect(ops.some(op => op.strokeStyle === '#ffd166')).toBe(true);
  });

  it('gives wiping, sweeping and washing distinct cleaning tools and motion', () => {
    const wiping = draw({ activity: 'wiping', timeMs: 150 })._ops;
    const sweeping = draw({ activity: 'sweeping', timeMs: 150 })._ops;
    const washing = draw({ activity: 'washing', timeMs: 150 })._ops;

    expect(wiping).not.toEqual(sweeping);
    expect(sweeping).not.toEqual(washing);
    expect(wiping).not.toEqual(washing);
    expect(wiping.some(op => op.op === 'fillRect')).toBe(true);
    expect(maxCoordinate(sweeping, 'y')).toBeGreaterThanOrEqual(20);
    expect(washing.some(op => op.op === 'arc' && op.radius >= 3 && op.radius <= 5)).toBe(true);
  });

  it('draws distinct appliance controls for each cooking pose', () => {
    const preparing = draw({ activity: 'preparing', timeMs: 150 })._ops;
    const cooking = ['toasting', 'baking', 'frying', 'blending', 'making_coffee'];
    const poses = cooking.map(activity => draw({ activity, timeMs: 150 })._ops);

    cooking.forEach(activity => {
      expect(draw({ activity, timeMs: 150 })._ops, activity).not.toEqual(preparing);
    });
    for (let i = 0; i < poses.length; i += 1) {
      for (let j = i + 1; j < poses.length; j += 1) {
        expect(poses[i], `${cooking[i]} vs ${cooking[j]}`).not.toEqual(poses[j]);
      }
    }
  });

  it('constrains seated feet', () => {
    const standing = draw({ activity: 'reading', timeMs: 0 })._ops;
    const seated = draw({ activity: 'reading', seated: true, timeMs: 0 })._ops;

    expect(standing).not.toEqual(seated);
    expect(maxCoordinate(seated, 'y')).toBeLessThanOrEqual(15);
    expect(maxCoordinate(standing, 'y')).toBeGreaterThan(15);
  });

  it('constrains lying geometry to the horizontal body', () => {
    const sleeping = draw({ activity: 'sleeping', lying: true, timeMs: 0 })._ops;

    expect(maxCoordinate(sleeping, 'x')).toBeGreaterThanOrEqual(20);
    expect(maxCoordinate(sleeping, 'y')).toBeLessThanOrEqual(8);
  });

  it('keeps a readable static sleep cue in reduced motion', () => {
    const ctx = draw({ activity: 'sleeping', lying: true, reducedMotion: true, timeMs: 0 });

    expect(fillTexts(ctx).some(op => op.text.toLowerCase() === 'z')).toBe(true);
  });

  it('suppresses transient water accents in reduced motion', () => {
    const normal = draw({ activity: 'washing', timeMs: 150 })._ops;
    const reduced = draw({ activity: 'washing', reducedMotion: true, timeMs: 150 })._ops;

    expect(normal.some(op => op.strokeStyle === WATER_COLOUR)).toBe(true);
    expect(reduced.some(op => op.strokeStyle === WATER_COLOUR)).toBe(false);
  });
});

describe('characterFigure walking and carrying', () => {
  const feet = ops => ops.filter(op => (
    (op.op === 'moveTo' || op.op === 'lineTo') && op.y >= 15 && op.y <= 26
  ));

  it('only strides when walking is true', () => {
    const stationary = draw({ activity: 'carrying', timeMs: 130, id: 'x' })._ops;
    const striding = draw({ activity: 'carrying', walking: true, timeMs: 130, id: 'x' })._ops;

    expect(feet(stationary).map(op => op.y)).toEqual([22, 22]);
    expect(feet(striding).map(op => op.y)).not.toEqual([22, 22]);
  });

  it('only strides a walking activity while walking is true', () => {
    const stationary = draw({ activity: 'walking', timeMs: 130, id: 'x' })._ops;
    const striding = draw({ activity: 'walking', walking: true, timeMs: 130, id: 'x' })._ops;

    expect(feet(stationary).map(op => op.y)).toEqual([22, 22]);
    expect(feet(striding).map(op => op.y)).not.toEqual([22, 22]);
  });

  it('steadies a carried load while walking', () => {
    const swinging = draw({ activity: 'walking', walking: true, timeMs: 130, id: 'x' })._ops;
    const loaded = draw({
      activity: 'walking', walking: true, carrying: true, timeMs: 130, id: 'x',
    })._ops;

    expect(loaded).not.toEqual(swinging);
    const loadedHands = loaded.filter(op => op.op === 'lineTo' && op.y >= 7 && op.y <= 13);
    expect(loadedHands.every(op => Math.abs(op.x) <= 5)).toBe(true);
    expect(swinging.some(op => (
      op.op === 'lineTo' && op.y >= 7 && op.y <= 13 && Math.abs(op.x) >= 7
    ))).toBe(true);
  });
});

describe('characterFigure transfer gestures', () => {
  describe.each(GESTURES)('%s gesture', gesture => {
    it('animates normally, freezes under reduced motion and keeps the anchor', () => {
      const early = draw({ activity: 'walking', walking: true, gesture, timeMs: 0, id: 'actor' });
      const later = draw({ activity: 'walking', walking: true, gesture, timeMs: 270, id: 'actor' });
      const reducedEarly = draw({
        activity: 'walking', walking: true, gesture, reducedMotion: true, timeMs: 0, id: 'actor',
      });
      const reducedLater = draw({
        activity: 'walking', walking: true, gesture, reducedMotion: true, timeMs: 8000, id: 'actor',
      });

      expect(early._ops).not.toEqual(later._ops);
      expect(reducedEarly._ops).toEqual(reducedLater._ops);
      expect(early.translate).toHaveBeenCalledWith(20, 30);
    });
  });

  it('suppresses the transient gesture overlay under reduced motion but keeps the static base activity', () => {
    const normalBase = draw({ activity: 'taking_order', timeMs: 120, id: 'actor' });
    const normalGesture = draw({
      activity: 'taking_order', gesture: 'pickup', timeMs: 120, id: 'actor',
    });
    const reducedBase = draw({
      activity: 'taking_order', timeMs: 120, id: 'actor', reducedMotion: true,
    });
    const reducedGesture = draw({
      activity: 'taking_order', gesture: 'pickup', timeMs: 8000, id: 'actor', reducedMotion: true,
    });

    expect(normalGesture._ops).not.toEqual(normalBase._ops);
    expect(reducedGesture._ops).toEqual(reducedBase._ops);
    expect(reducedGesture._ops).toContainEqual(expect.objectContaining({ op: 'fillRect', w: 7, h: 6 }));
  });
});

describe('characterFigure safe fallbacks', () => {
  it('renders a breathing idle pose for unknown activity names', () => {
    const early = draw({ activity: 'mystery_pose', timeMs: 0, id: 'actor' });
    const later = draw({ activity: 'mystery_pose', timeMs: 270, id: 'actor' });

    expect(early._ops).not.toEqual(later._ops);
    expect(early.arc).toHaveBeenCalled();
  });

  it('ignores non-finite activity timestamps without drawing NaN', () => {
    const nan = draw({ activity: 'wiping', timeMs: Number.NaN });
    const zero = draw({ activity: 'wiping', timeMs: 0 });

    expect(nan._ops).toEqual(zero._ops);
  });
});
