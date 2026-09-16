import cashierUrl from '../../images/cashier-station.png';
import chairUrl from '../../images/chair.png';
import dishwasherUrl from '../../images/dishwasher.png';
import drinksDispenserUrl from '../../images/drinks-dispenser.png';
import ovenUrl from '../../images/oven.png';
import ovenInUseUrl from '../../images/oven-in-use.png';
import serviceCounterUrl from '../../images/service-counter.png';
import sinkWithDirtyDishesUrl from '../../images/sink-with-dirty-dishes.png';
import sinkUrl from '../../images/sink.png';
import tableUrl from '../../images/table.png';
import tableDirtyUrl from '../../images/table-dirty.png';
import toasterUrl from '../../images/toaster.png';

const SPRITE_URLS = Object.freeze({
  cashier: cashierUrl,
  chair: chairUrl,
  dishwasher: dishwasherUrl,
  drinksDispenser: drinksDispenserUrl,
  oven: ovenUrl,
  ovenInUse: ovenInUseUrl,
  serviceCounter: serviceCounterUrl,
  sinkWithDirtyDishes: sinkWithDirtyDishesUrl,
  sink: sinkUrl,
  table: tableUrl,
  tableDirty: tableDirtyUrl,
  toaster: toasterUrl,
});

export function loadSprites() {
  return Object.fromEntries(Object.entries(SPRITE_URLS).map(([key, src]) => {
    const image = new Image();
    image.src = src;
    return [key, image];
  }));
}

function isDrawableImage(image) {
  return Boolean(image
    && image.complete
    && Number.isFinite(image.naturalWidth)
    && image.naturalWidth > 0
    && Number.isFinite(image.naturalHeight)
    && image.naturalHeight > 0);
}

const visibleBoundsCache = new WeakMap();

function fullSourceBounds(image) {
  return {
    x: 0,
    y: 0,
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function createReadbackCanvas(width, height) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    } catch {
      // Try the worker-friendly canvas implementation below when available.
    }
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(width, height);
    } catch {
      // Fall through to the full-source fallback.
    }
  }
  return null;
}

function findVisibleBounds(image) {
  const fallback = fullSourceBounds(image);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const canvas = createReadbackCanvas(width, height);
  if (!canvas || typeof canvas.getContext !== 'function') return fallback;
  if (typeof HTMLCanvasElement !== 'undefined'
    && canvas instanceof HTMLCanvasElement
    && typeof CanvasRenderingContext2D === 'undefined') return fallback;

  try {
    const readback = canvas.getContext('2d');
    if (!readback
      || typeof readback.drawImage !== 'function'
      || typeof readback.getImageData !== 'function') return fallback;

    readback.drawImage(image, 0, 0, width, height);
    const imageData = readback.getImageData(0, 0, width, height);
    const pixels = imageData?.data;
    if (!pixels) return fallback;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (pixels[(y * width + x) * 4 + 3] <= 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0 || maxY < 0) return fallback;
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    };
  } catch {
    return fallback;
  }
}

function getSourceBounds(image) {
  const cached = visibleBoundsCache.get(image);
  if (cached) return cached;
  const bounds = findVisibleBounds(image);
  visibleBoundsCache.set(image, bounds);
  return bounds;
}

export function drawSprite(
  ctx,
  sprites,
  key,
  x,
  y,
  width,
  height = width,
  rotation = 0,
) {
  const image = sprites?.[key];
  if (!isDrawableImage(image)) return false;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;

  const normalisedRotation = Number.isInteger(rotation)
    ? ((rotation % 4) + 4) % 4
    : 0;
  const quarterTurn = normalisedRotation % 2 === 1;
  const drawWidth = quarterTurn ? height : width;
  const drawHeight = quarterTurn ? width : height;
  const source = getSourceBounds(image);

  ctx.save();
  try {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(normalisedRotation * (Math.PI / 2));
    ctx.drawImage(image, source.x, source.y, source.width, source.height,
      -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } finally {
    ctx.restore();
  }
  return true;
}
