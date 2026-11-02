import { getHighTopCounterGeometry } from '../data/highTopCounters';
import { drawSprite } from './sprites';

/** The complete counter includes its stools; places remain independently dirty. */
export function drawHighTopCounter(ctx, counter, tables = [], sprites = {}) {
  const geometry = getHighTopCounterGeometry(counter);
  if (!geometry) return;
  const { x, y, w, h } = geometry.countertop;
  ctx.save();
  const footprint = geometry.footprint;
  const drawn = drawSprite(ctx, sprites, 'highTopCounter', footprint.x, footprint.y,
    footprint.w, footprint.h, counter.rotation);
  if (!drawn) {
    ctx.fillStyle = '#6b5b3a';
    ctx.fillRect(x, y, w, h);
  }
  for (const place of geometry.places) {
    if (tables.some(table => table.highTopCounterId === counter.id
      && table.counterSeatIndex === place.index && table.status === 'dirty')) {
      ctx.fillStyle = '#663333';
      ctx.fillRect(place.table.x, place.table.y, 20, 20);
    }
    const chair = place.chair;
    if (!drawn && !drawSprite(ctx, sprites, 'chair', chair.x, chair.y, 20, 20, chair.rotation + 2)) {
      ctx.fillStyle = '#5a4a30';
      ctx.fillRect(chair.x, chair.y, 20, 20);
      ctx.strokeStyle = '#b99b65';
      ctx.lineWidth = 1;
      ctx.strokeRect(chair.x + 3, chair.y + 3, 14, 14);
    }
  }
  if (!drawn) {
    ctx.strokeStyle = '#b99b65';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  ctx.restore();
}
