import cashierUrl from '../../images/cashier-station.png';
import chairUrl from '../../images/chair.png';
import dishwasherUrl from '../../images/dishwasher.png';
import ovenUrl from '../../images/oven.png';
import ovenInUseUrl from '../../images/oven_in_use.png';
import serviceCounterUrl from '../../images/service counter.png';
import sinkWithDirtyDishesUrl from '../../images/sink-with-dirty-dishes.png';
import sinkWithDishesUrl from '../../images/sink-with-dishes.png';
import sinkUrl from '../../images/sink.png';
import tableUrl from '../../images/table.png';
import toasterUrl from '../../images/toaster.png';

const SPRITE_URLS = Object.freeze({
  cashier: cashierUrl,
  chair: chairUrl,
  dishwasher: dishwasherUrl,
  oven: ovenUrl,
  ovenInUse: ovenInUseUrl,
  serviceCounter: serviceCounterUrl,
  sinkWithDirtyDishes: sinkWithDirtyDishesUrl,
  sinkWithDishes: sinkWithDishesUrl,
  sink: sinkUrl,
  table: tableUrl,
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

  ctx.save();
  try {
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate(normalisedRotation * (Math.PI / 2));
    ctx.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  } finally {
    ctx.restore();
  }
  return true;
}
