import { describe, expect, it } from 'vitest';
import { calculateFitCamera, adjustCameraZoom, resetCameraMode, createCamera, screenToWorld } from './camera';
import { getRestaurantWorld } from '../simulation/world';

describe('calculateFitCamera', () => {
  it('scales the full restaurant content into a shallow wide viewport', () => {
    const camera = calculateFitCamera({
      viewportWidth: 1826,
      viewportHeight: 391,
      worldX: 50,
      worldY: 50,
      worldWidth: 670,
      worldHeight: 500,
      padding: 24,
      maxZoom: 1,
    });

    expect(camera.zoom).toBeCloseTo(0.686, 3);
    expect(50 * camera.zoom + camera.x).toBeGreaterThanOrEqual(24);
    expect((50 + 500) * camera.zoom + camera.y).toBeLessThanOrEqual(391 - 24);
  });

  it('fits the larger level 1 restaurant in a 1920x1080 viewport', () => {
    const world = getRestaurantWorld({ expansionLevel: 1 });
    const camera = calculateFitCamera({
      viewportWidth: 1920,
      viewportHeight: 980,
      worldX: world.worldX,
      worldY: world.worldY,
      worldWidth: world.contentW,
      worldHeight: world.contentH,
      padding: 24,
      maxZoom: 1,
    });

    expect(world.worldX * camera.zoom + camera.x).toBeGreaterThanOrEqual(23);
    expect((world.worldX + world.contentW) * camera.zoom + camera.x).toBeLessThanOrEqual(1920 - 23);
    expect(world.worldY * camera.zoom + camera.y).toBeGreaterThanOrEqual(23);
    expect((world.worldY + world.contentH) * camera.zoom + camera.y).toBeLessThanOrEqual(980 - 23);
  });
});

describe('adjustCameraZoom', () => {
  it('sets manual mode and applies zoom factor clamped to min/max', () => {
    const cam = createCamera();
    cam.zoom = 1;
    cam.manual = false;
    adjustCameraZoom(cam, 1.1);
    expect(cam.manual).toBe(true);
    expect(cam.zoom).toBeCloseTo(1.1, 5);
  });

  it('clamps to maxZoom', () => {
    const cam = createCamera();
    cam.zoom = 3;
    cam.manual = false;
    adjustCameraZoom(cam, 1.5);
    expect(cam.manual).toBe(true);
    expect(cam.zoom).toBe(3);
  });

  it('clamps to minZoom', () => {
    const cam = createCamera();
    cam.zoom = 0.2;
    cam.manual = true;
    adjustCameraZoom(cam, 0.5);
    expect(cam.zoom).toBe(0.2);
  });

  it('zoom in (factor > 1) increases zoom', () => {
    const cam = createCamera();
    cam.zoom = 1;
    adjustCameraZoom(cam, 1.2);
    expect(cam.zoom).toBeCloseTo(1.2, 5);
  });

  it('zoom out (factor < 1) decreases zoom', () => {
    const cam = createCamera();
    cam.zoom = 1;
    adjustCameraZoom(cam, 0.9);
    expect(cam.zoom).toBe(0.9);
  });

  it('keeps the world point under an anchor fixed while zooming in and out with an offset camera', () => {
    for (const factor of [1.1, 0.9]) {
      const cam = createCamera();
      cam.x = 120;
      cam.y = -45;
      cam.zoom = 0.8;
      const anchor = { x: 640, y: 360 };
      const before = screenToWorld(cam, anchor.x, anchor.y);

      adjustCameraZoom(cam, factor, anchor);

      expect(cam.manual).toBe(true);
      const after = screenToWorld(cam, anchor.x, anchor.y);
      expect(after.x).toBeCloseTo(before.x, 5);
      expect(after.y).toBeCloseTo(before.y, 5);
    }
  });

  it('does not drift the translation when the zoom is clamped at a bound', () => {
    const cam = createCamera();
    cam.x = 40;
    cam.y = 25;
    cam.zoom = cam.maxZoom;

    adjustCameraZoom(cam, 1.5, { x: 300, y: 200 });

    expect(cam.zoom).toBe(cam.maxZoom);
    expect(cam.x).toBe(40);
    expect(cam.y).toBe(25);

    cam.zoom = cam.minZoom;
    adjustCameraZoom(cam, 0.5, { x: 300, y: 200 });

    expect(cam.zoom).toBe(cam.minZoom);
    expect(cam.x).toBe(40);
    expect(cam.y).toBe(25);
  });

  it('retains the two-argument translation behaviour without an anchor', () => {
    const cam = createCamera();
    cam.x = 12;
    cam.y = 34;
    cam.zoom = 1;

    adjustCameraZoom(cam, 1.2);

    expect(cam.manual).toBe(true);
    expect(cam.zoom).toBeCloseTo(1.2, 5);
    expect(cam.x).toBe(12);
    expect(cam.y).toBe(34);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', {}],
    ['NaN x', { x: NaN, y: 10 }],
    ['infinite y', { x: 10, y: Infinity }],
    ['numeric strings', { x: '10', y: '20' }],
  ])('ignores an invalid anchor (%s) and keeps the unanchored translation', (_label, anchor) => {
    const cam = createCamera();
    cam.x = 7;
    cam.y = 9;
    cam.zoom = 1;
    const reference = createCamera();
    reference.x = 7;
    reference.y = 9;
    reference.zoom = 1;

    adjustCameraZoom(cam, 1.1, anchor);
    adjustCameraZoom(reference, 1.1);

    expect(cam.zoom).toBeCloseTo(reference.zoom, 10);
    expect(cam.x).toBe(reference.x);
    expect(cam.y).toBe(reference.y);
    expect(cam.manual).toBe(true);
  });
});

describe('resetCameraMode', () => {
  it('sets manual to false', () => {
    const cam = createCamera();
    cam.manual = true;
    resetCameraMode(cam);
    expect(cam.manual).toBe(false);
  });
});
