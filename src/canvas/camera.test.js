import { describe, expect, it } from 'vitest';
import { calculateFitCamera, adjustCameraZoom, resetCameraMode, createCamera } from './camera';
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
});

describe('resetCameraMode', () => {
  it('sets manual to false', () => {
    const cam = createCamera();
    cam.manual = true;
    resetCameraMode(cam);
    expect(cam.manual).toBe(false);
  });
});
