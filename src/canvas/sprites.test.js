import { describe, expect, it, vi } from 'vitest';
import { drawSprite, loadSprites } from './sprites';

function makeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
  };
}

function loadedImage() {
  return { complete: true, naturalWidth: 300, naturalHeight: 100 };
}

describe('loadSprites', () => {
  it('maps every supplied asset to a newly created image', () => {
    const images = [];
    const ImageMock = vi.fn(function MockImage() {
      const image = {};
      images.push(image);
      return image;
    });
    vi.stubGlobal('Image', ImageMock);

    try {
      const sprites = loadSprites();

      expect(Object.keys(sprites)).toEqual([
        'cashier', 'chair', 'dishwasher', 'oven', 'ovenInUse', 'serviceCounter',
        'sinkWithDirtyDishes', 'sinkWithDishes', 'sink', 'table', 'toaster',
      ]);
      expect(ImageMock).toHaveBeenCalledTimes(11);
      expect(Object.values(sprites)).toEqual(images);
      const sourceFragments = {
        cashier: 'cashier-station',
        chair: 'chair',
        dishwasher: 'dishwasher',
        oven: 'oven',
        ovenInUse: 'oven_in_use',
        serviceCounter: 'service',
        sinkWithDirtyDishes: 'sink-with-dirty-dishes',
        sinkWithDishes: 'sink-with-dishes',
        sink: 'sink',
        table: 'table',
        toaster: 'toaster',
      };
      for (const [key, fragment] of Object.entries(sourceFragments)) {
        expect(String(sprites[key].src)).toContain(fragment);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('drawSprite', () => {
  it('returns false without drawing when a sprite is missing or not loaded', () => {
    const ctx = makeCtx();
    expect(drawSprite(ctx, {}, 'table', 10, 20, 40, 40)).toBe(false);
    expect(drawSprite(ctx, {
      table: { complete: false, naturalWidth: 0, naturalHeight: 0 },
    }, 'table', 10, 20, 40, 40)).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('returns false for pending and failed image decodes', () => {
    const ctx = makeCtx();
    const pending = { complete: false, naturalWidth: 300, naturalHeight: 100 };
    const failed = { complete: true, naturalWidth: 0, naturalHeight: 0 };

    expect(drawSprite(ctx, { table: pending }, 'table', 10, 20, 40, 40)).toBe(false);
    expect(drawSprite(ctx, { table: failed }, 'table', 10, 20, 40, 40)).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws a loaded image at normal dimensions around the destination centre', () => {
    const ctx = makeCtx();
    const image = loadedImage();

    expect(drawSprite(ctx, { table: image }, 'table', 10, 20, 40)).toBe(true);

    expect(ctx.translate).toHaveBeenCalledWith(30, 40);
    expect(ctx.rotate).toHaveBeenCalledWith(0);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, -20, -20, 40, 40);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('returns false without drawing for invalid destination dimensions', () => {
    const ctx = makeCtx();
    const image = loadedImage();

    expect(drawSprite(ctx, { table: image }, 'table', 10, 20, 0, 40)).toBe(false);
    expect(drawSprite(ctx, { table: image }, 'table', 10, 20, 40, Infinity)).toBe(false);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('draws a quarter-turned image around the destination centre', () => {
    const ctx = makeCtx();
    const image = loadedImage();

    expect(drawSprite(ctx, { serviceCounter: image }, 'serviceCounter',
      300, 120, 40, 120, 1)).toBe(true);

    expect(ctx.translate).toHaveBeenCalledWith(320, 180);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, -60, -20, 120, 40);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('normalises negative and non-integer rotations', () => {
    const ctx = makeCtx();
    const image = loadedImage();

    expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 20, 30, -1)).toBe(true);
    expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 20, 30, 1.5)).toBe(true);

    expect(ctx.rotate).toHaveBeenNthCalledWith(1, 3 * Math.PI / 2);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, image, -15, -10, 30, 20);
    expect(ctx.rotate).toHaveBeenNthCalledWith(2, 0);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, image, -10, -15, 20, 30);
  });
});
