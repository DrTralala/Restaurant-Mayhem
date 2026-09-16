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

function stubCanvasReadback(context) {
  const scratchCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
  };
  const originalCreateElement = document.createElement.bind(document);
  const createElement = vi.spyOn(document, 'createElement').mockImplementation(tagName => (
    tagName === 'canvas' ? scratchCanvas : originalCreateElement(tagName)
  ));
  return { scratchCanvas, createElement };
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
        'cashier', 'chair', 'dishwasher', 'drinksDispenser', 'oven', 'ovenInUse', 'serviceCounter',
        'sinkWithDirtyDishes', 'sink', 'table', 'tableDirty', 'toaster',
      ]);
      expect(ImageMock).toHaveBeenCalledTimes(12);
      expect(Object.values(sprites)).toEqual(images);
      const sourceFragments = {
        cashier: 'cashier-station',
        chair: 'chair',
        dishwasher: 'dishwasher',
        drinksDispenser: 'drinks-dispenser',
        oven: 'oven',
        ovenInUse: 'oven-in-use',
        serviceCounter: 'service-counter',
        sinkWithDirtyDishes: 'sink-with-dirty-dishes',
        sink: 'sink',
        table: 'table',
        tableDirty: 'table-dirty',
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
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 300, 100, -20, -20, 40, 40);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('crops transparent source margins once while preserving destination geometry', () => {
    const ctx = makeCtx();
    const image = { complete: true, naturalWidth: 6, naturalHeight: 5 };
    const pixels = new Uint8ClampedArray(6 * 5 * 4);
    for (const [x, y] of [
      [1, 1], [2, 1], [3, 1], [4, 1],
      [1, 2], [2, 2], [3, 2], [4, 2],
      [1, 3], [2, 3], [3, 3], [4, 3],
    ]) pixels[(y * 6 + x) * 4 + 3] = 255;
    const readback = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: pixels })),
    };
    const { createElement } = stubCanvasReadback(readback);

    try {
      expect(drawSprite(ctx, { table: image }, 'table', 10, 20, 40, 60)).toBe(true);
      expect(drawSprite(ctx, { table: image }, 'table', 10, 20, 40, 60, 1)).toBe(true);

      expect(ctx.drawImage).toHaveBeenNthCalledWith(
        1, image, 1, 1, 4, 3, -20, -30, 40, 60,
      );
      expect(ctx.drawImage).toHaveBeenNthCalledWith(
        2, image, 1, 1, 4, 3, -30, -20, 60, 40,
      );
      expect(createElement).toHaveBeenCalledTimes(1);
      expect(readback.drawImage).toHaveBeenCalledTimes(1);
      expect(readback.getImageData).toHaveBeenCalledWith(0, 0, 6, 5);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('falls back to the full source when alpha readback fails and caches that result', () => {
    const ctx = makeCtx();
    const image = { complete: true, naturalWidth: 8, naturalHeight: 4 };
    const readback = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => { throw new Error('readback unavailable'); }),
    };
    const { createElement } = stubCanvasReadback(readback);

    try {
      expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 32, 16)).toBe(true);
      expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 32, 16)).toBe(true);

      expect(ctx.drawImage).toHaveBeenNthCalledWith(1, image, 0, 0, 8, 4, -16, -8, 32, 16);
      expect(ctx.drawImage).toHaveBeenNthCalledWith(2, image, 0, 0, 8, 4, -16, -8, 32, 16);
      expect(createElement).toHaveBeenCalledTimes(1);
      expect(readback.getImageData).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('falls back to the full source when readback finds no visible pixels', () => {
    const ctx = makeCtx();
    const image = { complete: true, naturalWidth: 5, naturalHeight: 7 };
    const readback = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(5 * 7 * 4) })),
    };
    stubCanvasReadback(readback);

    try {
      expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 20, 30)).toBe(true);
      expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 5, 7, -10, -15, 20, 30);
    } finally {
      vi.restoreAllMocks();
    }
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
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 300, 100, -60, -20, 120, 40);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('normalises negative and non-integer rotations', () => {
    const ctx = makeCtx();
    const image = loadedImage();

    expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 20, 30, -1)).toBe(true);
    expect(drawSprite(ctx, { table: image }, 'table', 0, 0, 20, 30, 1.5)).toBe(true);

    expect(ctx.rotate).toHaveBeenNthCalledWith(1, 3 * Math.PI / 2);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(1, image, 0, 0, 300, 100, -15, -10, 30, 20);
    expect(ctx.rotate).toHaveBeenNthCalledWith(2, 0);
    expect(ctx.drawImage).toHaveBeenNthCalledWith(2, image, 0, 0, 300, 100, -10, -15, 20, 30);
  });
});
