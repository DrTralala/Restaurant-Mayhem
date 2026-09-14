import { getDoors, getRestaurantWorld, getDefaultStaffPosition } from '../simulation/world';
import { getPlacementRect } from '../simulation/placement';
import { getCharacterPalette } from './characterAppearance';
import { getServiceItemEmoji } from './serviceItemEmoji';
import { getPlaceSettingPositions } from './tableGeometry';
import { getSeatedDisplayGeometry } from './seatedGeometry';
import { getRemainingFraction } from '../simulation/activity';
import { getWashStationCapacity, getWashStationOccupancy } from '../simulation/dishwashing';
import { getDishwasherStats } from '../simulation/dishwasherProgression';
import { getQueueDisplayLayout } from '../simulation/customerQueue';
import { getCustomerConsumptionRemainingFraction } from '../simulation/consumption';
import { getPlaceableDimensions } from '../data/placeables';
import { getCharacterMovementStatus } from '../simulation/movement';
import { getCarriedServiceItemIds } from '../simulation/staffInventory';
import { getServiceItemProgress, getStaffTaskRemainingFraction } from '../simulation/staffPerformance';
import { getFoodPatienceFraction } from '../simulation/foodPatience';
import { getAmenityGeometry } from '../data/staffAmenities';
import { getCanvasFont } from '../typography';

const CANVAS_LABEL_FONT = getCanvasFont('compact');

function labelRect(rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  const width = Number.isFinite(rect.w) ? rect.w : rect.width;
  const height = Number.isFinite(rect.h) ? rect.h : rect.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { x: rect.x, y: rect.y, w: width, h: height };
}

function labelTextWidth(ctx, text) {
  const measured = typeof ctx.measureText === 'function' ? ctx.measureText(text)?.width : null;
  return Number.isFinite(measured) ? measured : String(text).length * 5;
}

function splitLabelWord(ctx, word, maxWidth) {
  if (labelTextWidth(ctx, word) <= maxWidth) return [word];
  const pieces = [];
  let piece = '';
  for (const character of String(word)) {
    const candidate = piece + character;
    if (piece && labelTextWidth(ctx, candidate) > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces.length > 0 ? pieces : [''];
}

function wrapLabelText(ctx, label, maxWidth) {
  const paragraphs = String(label ?? '').split('\n');
  const lines = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim() ? paragraph.trim().split(/\s+/) : [''];
    let current = '';
    for (const word of words) {
      for (const piece of splitLabelWord(ctx, word, maxWidth)) {
        const candidate = current ? `${current} ${piece}` : piece;
        if (current && labelTextWidth(ctx, candidate) > maxWidth) {
          lines.push(current);
          current = piece;
        } else {
          current = candidate;
        }
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

/** Draw one readable, centred object label without leaking canvas state. */
export function drawObjectLabel(ctx, label, rect, options = {}) {
  const target = labelRect(rect);
  if (!target || label == null || String(label).trim() === '') return null;

  const padding = Number.isFinite(options.padding) ? Math.max(0, options.padding) : 2;
  const lineHeight = Number.isFinite(options.lineHeight) ? Math.max(9, options.lineHeight) : 10;
  const font = options.font || CANVAS_LABEL_FONT;
  const contrast = options.contrast === 'light';
  const textColour = options.color || options.textColor || (contrast ? '#111' : '#fff');
  const background = options.background
    || (contrast ? 'rgba(255,255,255,0.82)' : 'rgba(0,0,0,0.72)');

  ctx.save();
  ctx.font = font;
  const maxWidth = Number.isFinite(options.maxWidth)
    ? Math.max(1, options.maxWidth)
    : options.allowOverflow
      ? Number.POSITIVE_INFINITY
      : Math.max(1, target.w - padding * 2);
  const lines = wrapLabelText(ctx, label, maxWidth);
  const measuredWidth = Math.max(...lines.map(line => labelTextWidth(ctx, line)), 1);
  const boxWidth = options.allowOverflow
    ? Math.max(target.w, measuredWidth + padding * 2)
    : Math.min(target.w, measuredWidth + padding * 2);
  const boxHeight = lines.length * lineHeight + padding * 2;
  const centreX = target.x + target.w / 2;
  const centreY = target.y + target.h / 2;

  ctx.fillStyle = background;
  ctx.fillRect(centreX - boxWidth / 2, centreY - boxHeight / 2, boxWidth, boxHeight);
  ctx.fillStyle = textColour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const firstLineY = centreY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => ctx.fillText(line, centreX, firstLineY + index * lineHeight));
  ctx.restore();

  return { lines, x: centreX, y: centreY, width: boxWidth, height: boxHeight };
}

function drawVerticalProgress(ctx, x, y, remaining, {
  fill = '#ffd400',
  track = '#8a6a00',
} = {}) {
  if (!Number.isFinite(remaining)) return;
  const height = 14;
  const filled = height * Math.min(1, Math.max(0, remaining));
  ctx.save(); ctx.strokeStyle = track; ctx.strokeRect(x, y, 3, height);
  ctx.fillStyle = fill; ctx.fillRect(x + 1, y + height - filled, 1, filled); ctx.restore();
}

function drawFoodPatienceMeter(ctx, x, y, remaining) {
  if (!Number.isFinite(remaining)) return;
  const width = 14;
  const height = 3;
  const filled = width * Math.min(1, Math.max(0, remaining));
  ctx.save();
  ctx.fillStyle = '#5a2d20';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = '#ff9f43';
  ctx.fillRect(x, y, filled, height);
  ctx.restore();
}

function staffProgress(state, staff, movement) {
  const travellingToTask = staff.navigationGoal
    && movement.plan !== 'arrived';
  if (!staff.task || travellingToTask || staff.task.type === 'wash_item') return null;
  return getStaffTaskRemainingFraction(state, staff);
}

function animationOffset(id = '') {
  return [...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.17;
}

function drawStickFigure(ctx, x, y, color, {
  seated = false,
  lying = false,
  walking = false,
  cleaning = false,
  timeMs = 0,
  reducedMotion = false,
  id = '',
  scale = 1,
  rotation = 0,
} = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(scale, scale);
  const localX = 0;
  const localY = 0;
  const stride = walking && !cleaning && !reducedMotion
    ? Math.sin(timeMs * 0.012 + animationOffset(id)) * 4
    : 0;
  const wipe = cleaning && !reducedMotion
    ? Math.sin(timeMs * 0.012 + animationOffset(id)) * 5
    : 0;
  const leftHandX = cleaning ? localX + 3 + wipe : localX - 8;
  const rightHandX = cleaning ? localX + 9 + wipe : localX + 8;
  const handY = cleaning ? localY + 12 : localY + 10;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(localX, localY, 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  if (lying) {
    // A resident on a bed is drawn along the bed's long axis. The caller
    // rotates this small pose to match the furniture, so the head stays at
    // the authoritative slot anchor instead of being re-positioned by the
    // renderer.
    ctx.moveTo(localX + 4, localY);
    ctx.lineTo(localX + 16, localY);
    ctx.moveTo(localX + 8, localY - 3);
    ctx.lineTo(localX + 8, localY + 5);
    ctx.moveTo(localX + 16, localY);
    ctx.lineTo(localX + 23, localY - 5);
    ctx.moveTo(localX + 16, localY);
    ctx.lineTo(localX + 23, localY + 5);
  } else {
    ctx.moveTo(localX, localY + 4);
    ctx.lineTo(localX, localY + 14);
    ctx.moveTo(localX, localY + 7);
    ctx.lineTo(leftHandX, handY + stride);
    ctx.moveTo(localX, localY + 7);
    ctx.lineTo(rightHandX, handY - stride);
    ctx.moveTo(localX, localY + 14);
    ctx.lineTo(localX - 6, seated ? localY + 15 : localY + 22 - stride);
    ctx.moveTo(localX, localY + 14);
    ctx.lineTo(localX + 6, seated ? localY + 15 : localY + 22 + stride);
  }
  ctx.stroke();

  // Hands remain visible at small canvas scales.
  ctx.fillRect(leftHandX - 1, handY, 2, 2);
  ctx.fillRect(rightHandX - 1, handY, 2, 2);

  if (cleaning) {
    ctx.strokeStyle = '#f3e6bd';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(leftHandX - 1, handY + 3);
    ctx.lineTo(rightHandX + 2, handY + 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawMenu(ctx, { x, y, width, height }) {
  const centreX = x + width / 2;
  ctx.save();
  ctx.fillStyle = '#f3e6bd';
  ctx.strokeStyle = '#4d3a1f';
  ctx.lineWidth = 1.5;
  ctx.fillRect(x, y, width, height);
  ctx.strokeRect(x, y, width, height);
  ctx.beginPath();
  ctx.moveTo(centreX, y + 1);
  ctx.lineTo(centreX, y + height - 1);
  ctx.moveTo(x + 3, y + 5);
  ctx.lineTo(centreX - 3, y + 5);
  ctx.moveTo(centreX + 3, y + 5);
  ctx.lineTo(x + width - 3, y + 5);
  ctx.stroke();
  ctx.restore();
}

function getStaffAmenity(state, residency) {
  if (residency?.kind !== 'staff_amenity' || residency.amenityId == null) return null;
  return (state.staffAmenities || []).find(amenity =>
    String(amenity?.id) === String(residency.amenityId));
}

function getStaffAmenityById(state, amenityId) {
  if (amenityId == null) return null;
  return (state.staffAmenities || []).find(amenity =>
    String(amenity?.id) === String(amenityId));
}

function getStaffAmenityAnchor(state, staff) {
  const amenity = getStaffAmenity(state, staff?.movementResidency);
  if (!amenity) return null;
  const geometry = getAmenityGeometry(amenity);
  const slotIndex = staff.movementResidency.slotIndex;
  const anchor = geometry?.slotAnchors?.[slotIndex] || geometry?.slotAnchors?.[0];
  return anchor ? { amenity, geometry, anchor } : null;
}

function getAmenityActivityRemaining(state, staff, amenity) {
  if (staff?.amenityUse?.phase !== 'occupied') return null;
  const startedAt = staff.amenityUse.activityStartedAt;
  const endAt = amenity?.type === 'bed'
    ? staff.ptoSession?.minimumEndAt ?? staff.amenityUse.activityEndsAt
    : staff.amenityUse.activityEndsAt;
  if (![startedAt, endAt, state.restaurant?.gameTime].every(Number.isFinite)
    || endAt <= startedAt) return null;
  return getRemainingFraction(state.restaurant.gameTime, startedAt, endAt - startedAt);
}

function drawStaffAmenity(ctx, amenity) {
  const geometry = getAmenityGeometry(amenity);
  if (!geometry) return;
  const { x, y, w, h } = geometry.footprint;
  const colours = {
    couch: { fill: '#6d4e71', stroke: '#c18ac6' },
    arcade: { fill: '#365b70', stroke: '#74c7d9' },
    bed: { fill: '#8b604e', stroke: '#d6a07c' },
  };
  const colour = colours[amenity.type] || { fill: '#555', stroke: '#aaa' };
  ctx.fillStyle = colour.fill;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.strokeStyle = colour.stroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  ctx.restore();

  // A small visual cue differentiates the two-seat couch without adding a
  // second fixture record or altering the simulation geometry.
  if (amenity.type === 'couch' && w >= 40 && h >= 20) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 2);
    ctx.lineTo(x + w / 2, y + h - 2);
    ctx.stroke();
    ctx.restore();
  }

  const labels = { couch: 'Couch', arcade: 'Arcade', bed: 'Bed' };
  drawObjectLabel(ctx, labels[amenity.type] || amenity.type, geometry.footprint, {
    background: 'rgba(0,0,0,0.58)',
    allowOverflow: true,
  });
}

export function drawFloorLayer(ctx, state, camera) {
  const { restaurant } = state;
  const world = getRestaurantWorld(restaurant);

  ctx.fillStyle = '#2d1f0e';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // Dining area
  ctx.fillStyle = '#2d1f0e';
  ctx.fillRect(world.floorX, world.diningY, world.floorW, world.areaH + 50);

  // Grid lines in dining area
  ctx.strokeStyle = 'rgba(80,80,80,0.3)';
  ctx.lineWidth = 0.5;
  for (let gx = world.floorX + 10; gx < world.floorX + world.floorW; gx += 20) {
    ctx.beginPath();
    ctx.moveTo(gx, world.diningY);
    ctx.lineTo(gx, world.diningY + world.areaH + 50);
    ctx.stroke();
  }
  for (let gy = world.diningY; gy < world.diningY + world.areaH + 50; gy += 20) {
    ctx.beginPath();
    ctx.moveTo(world.floorX + 10, gy);
    ctx.lineTo(world.floorX + world.floorW - 10, gy);
    ctx.stroke();
  }

  // Kitchen area
  ctx.fillStyle = '#333';
  ctx.fillRect(world.floorX, world.kitchenY, world.floorW, 50);

  // Wall
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 3;
  ctx.strokeRect(world.floorX, world.kitchenY, world.floorW, world.floorH);

  // Door gaps in the right wall.
  ctx.fillStyle = '#000000';
  for (const door of getDoors(state)) ctx.fillRect(world.doorX, door.y, 6, 40);

  // Cashier station at the top-right of the dining room.
  for (const cashier of state.cashierStations || []) {
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(cashier.x, cashier.y, cashier.w, cashier.h);
    ctx.strokeStyle = '#8a7a6a';
    ctx.strokeRect(cashier.x, cashier.y, cashier.w, cashier.h);
    drawObjectLabel(ctx, 'Cashier', {
      x: cashier.x,
      y: cashier.y,
      w: cashier.w,
      h: cashier.h,
    }, { background: 'rgba(0,0,0,0.58)' });
  }

  // Queue area outside the door.
  ctx.fillStyle = '#252530';
  ctx.fillRect(world.queueX, world.queueY, world.queueW, world.queueH);
  ctx.strokeStyle = '#444';
  ctx.strokeRect(world.queueX, world.queueY, world.queueW, world.queueH);

  ctx.restore();
}

export function drawQueueLayer(ctx, state, camera, renderOptions = {}) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const layout = getQueueDisplayLayout(state, state.queue || []);
  for (const member of layout.visibleMembers) {
    drawStickFigure(ctx, member.x, member.y - 4, getCharacterPalette(member).figure, {
      id: member.id,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });
  }

  if (layout.hiddenCount > 0) {
    ctx.fillStyle = '#f0a500';
    ctx.font = getCanvasFont('heading');
    ctx.textAlign = 'center';
    ctx.fillText(`+${layout.hiddenCount}`, layout.overflowLabelPosition.x, layout.overflowLabelPosition.y);
  }

  ctx.restore();
}

export function drawFurnitureLayer(ctx, state, camera) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  for (const table of state.tables) {
    const tx = table.x;
    const ty = table.y;

    // Table surface (2x2 = 40x40)
    const tableColor = table.status === 'dirty' ? '#663333'
      : table.status === 'occupied' ? '#4a6741' : '#6b5b3a';
    ctx.fillStyle = tableColor;
    ctx.fillRect(tx, ty, 40, 40);

  }

  // Chairs (drawn from chairs array — independently movable, rotatable)
  for (const chair of state.chairs) {
    ctx.fillStyle = '#5a4a30';
    ctx.fillRect(chair.x, chair.y, 20, 20);
    // Direction indicator
    ctx.fillStyle = '#f0d080';
    const rot = chair.rotation || 0;
    const cx = chair.x + 10, cy = chair.y + 10;
    const arrows = ['↑', '→', '↓', '←'];
    ctx.save();
    ctx.font = getCanvasFont('icon');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrows[rot] || arrows[0], cx, cy);
    ctx.restore();
  }

  for (const station of state.kitchenStations || []) {
    ctx.fillStyle = '#555';
    ctx.fillRect(station.x, station.y, 40, 40);
    const eq = station.equipmentId
      ? (state.equipment || []).find(e => e.id === station.equipmentId)
      : null;
    if (eq) {
      ctx.fillStyle = '#888';
      ctx.fillRect(station.x + 5, station.y + 5, 30, 30);
      drawObjectLabel(ctx, eq.name, { x: station.x + 2, y: station.y + 2, w: 36, h: 36 }, {
        background: 'rgba(0,0,0,0.58)',
        allowOverflow: true,
      });
    } else {
      drawObjectLabel(ctx, 'Kitchen\nstation', { x: station.x, y: station.y, w: 40, h: 40 }, {
        background: 'rgba(0,0,0,0.58)',
      });
    }
  }

  // Service tables (long counter between kitchen and dining)
  for (const st of state.serviceTables || []) {
    const dimensions = getPlaceableDimensions('serviceTable', st.rotation);
    ctx.fillStyle = '#4a6a4a';
    ctx.fillRect(st.x, st.y, dimensions.width, dimensions.height);
    drawObjectLabel(ctx, 'Service counter', {
      x: st.x,
      y: st.y,
      w: dimensions.width,
      h: dimensions.height,
    }, { background: 'rgba(0,0,0,0.58)' });
  }

  for (const amenity of state.staffAmenities || []) drawStaffAmenity(ctx, amenity);

  ctx.font = getCanvasFont('label');
  for (const dirt of state.floorDirt || []) {
    if (Number.isFinite(dirt.x) && Number.isFinite(dirt.y)) ctx.fillText('💦', dirt.x - 5, dirt.y + 5);
  }
  for (const station of state.washStations || []) {
    const w = station.w || 40, h = station.h || 40;
    ctx.fillStyle = station.type === 'automatic' ? '#536b75' : '#466b62';
    ctx.fillRect(station.x, station.y, w, h);
    ctx.save();
    ctx.strokeStyle = '#9ab0aa';
    ctx.lineWidth = 1;
    ctx.strokeRect(station.x + 0.5, station.y + 0.5, w - 1, h - 1);
    ctx.restore();
    drawObjectLabel(ctx, station.type === 'automatic' ? 'Dish\nwasher' : 'Sink', {
      x: station.x, y: station.y, w, h,
    }, { background: 'rgba(0,0,0,0.58)' });
    const items = (state.serviceItems || []).filter(item => item.washStationId === station.id
      && ['queued_for_wash', 'washing'].includes(item.state));
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = getCanvasFont('compact');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${getWashStationOccupancy(state, station)} / ${getWashStationCapacity(station)}`,
      station.x + w / 2, station.y + h + 10);
    ctx.restore();
    const active = items.find(item => item.state === 'washing');
    if (active) {
      const remaining = station.type === 'automatic'
        ? getRemainingFraction(
          state.restaurant?.gameTime,
          active.washStartedAt,
          getDishwasherStats(Number.isInteger(station.level) ? station.level : 1)?.secondsPerDish,
        )
        : getServiceItemProgress(state, active)?.remaining;
      drawVerticalProgress(ctx, station.x + w + 2, station.y + 18, remaining);
    }
  }

  for (const item of Array.isArray(state.serviceItems) ? state.serviceItems : []) {
    const kitchenDish = item.kind === 'dish'
      && ['preparing', 'ready'].includes(item.state)
      && (state.kitchenStations || []).some(station => station.id === item.stationId);
    if (!kitchenDish && !['on_service', 'delivered', 'dirty_at_table'].includes(item.state)
      || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    ctx.fillStyle = '#fff';
    ctx.font = getCanvasFont('item');
    if (kitchenDish) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(getServiceItemEmoji(item, state.dishes || []), item.x, item.y);
      ctx.restore();
      continue;
    }
    if (['delivered', 'dirty_at_table'].includes(item.state)) {
      const customer = (state.customers || []).find(candidate => candidate.id === item.customerId);
      const chair = customer && (state.chairs || []).find(candidate => candidate.id === customer.chairId);
      const table = customer && (state.tables || []).find(candidate => candidate.id === customer.tableId);
      if (!customer || !chair || !table) continue;
      const kinds = [...new Set((state.serviceItems || [])
        .filter(candidate => candidate.customerId === item.customerId
          && ['delivered', 'dirty_at_table'].includes(candidate.state))
        .map(candidate => candidate.kind))];
      const position = getPlaceSettingPositions(table, chair, kinds)[item.kind];
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(getServiceItemEmoji(item, state.dishes || []), position.x, position.y);
        ctx.restore();
      }
      continue;
    }
    ctx.fillText(getServiceItemEmoji(item, state.dishes || []), item.x, item.y);
  }

  ctx.restore();
}

export function drawPlacementPreview(ctx, state, camera, placement) {
  const rect = getPlacementRect(
    placement?.itemType,
    placement?.x,
    placement?.y,
    placement?.rotation,
  );
  if (!rect) return;

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const valid = placement.valid;
  ctx.fillStyle = valid ? 'rgba(70,200,110,0.45)' : 'rgba(220,70,70,0.45)';
  ctx.strokeStyle = valid ? 'rgba(70,200,110,0.9)' : 'rgba(220,70,70,0.9)';
  ctx.lineWidth = 2 / camera.zoom;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

  if (placement.itemType === 'chair') {
    const arrows = ['↑', '→', '↓', '←'];
    const rotation = ((placement.rotation || 0) % 4 + 4) % 4;
    ctx.fillStyle = '#f3e6bd';
    ctx.font = getCanvasFont('icon');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrows[rotation], rect.x + rect.w / 2, rect.y + rect.h / 2);
  } else if (placement.itemType === 'cashierTable') {
    drawObjectLabel(ctx, 'Cashier', rect, { background: 'rgba(0,0,0,0.58)' });
  } else if (placement.itemType === 'serviceTable') {
    drawObjectLabel(ctx, 'Service counter', rect, { background: 'rgba(0,0,0,0.58)' });
  } else if (placement.itemType === 'equipmentStation') {
    const equipment = (state.equipment || []).find(candidate => candidate.id === placement.equipmentId);
    if (equipment) {
      drawObjectLabel(ctx, equipment.name, rect, {
        background: 'rgba(0,0,0,0.58)',
        allowOverflow: true,
      });
    }
  } else if (placement.itemType === 'kitchenStation') {
    drawObjectLabel(ctx, 'Kitchen\nstation', rect, { background: 'rgba(0,0,0,0.58)' });
  } else if (placement.itemType === 'automaticDishwasher') {
    drawObjectLabel(ctx, 'Dish\nwasher', rect, { background: 'rgba(0,0,0,0.58)' });
  } else if (placement.itemType === 'manualSink') {
    drawObjectLabel(ctx, 'Sink', rect, { background: 'rgba(0,0,0,0.58)' });
  } else if (['couch', 'arcade', 'bed'].includes(placement.itemType)) {
    drawObjectLabel(ctx, placement.itemType[0].toUpperCase() + placement.itemType.slice(1), rect, {
      background: 'rgba(0,0,0,0.58)',
      allowOverflow: true,
    });
  }

  ctx.restore();
}

export function drawStaffLayer(ctx, state, camera, renderOptions = {}) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const renderedStaff = [];
  for (const [index, s] of (state.staff || []).entries()) {
    const movement = getCharacterMovementStatus(state, s.id);
    const hasCoords = Number.isFinite(s.x) && Number.isFinite(s.y);
    const pos = hasCoords
      ? { x: s.x, y: s.y }
      : getDefaultStaffPosition(s.role, index, state, s.id);
    const residency = getStaffAmenityAnchor(state, s);
    const amenity = residency?.amenity || getStaffAmenityById(state, s.amenityUse?.amenityId);
    const isResident = Boolean(residency
      && s.amenityUse?.phase === 'occupied'
      && ['couch', 'bed'].includes(residency.amenity.type));
    const x = isResident ? residency.anchor.x : pos.x;
    const y = isResident ? residency.anchor.y : pos.y - 4;
    const seated = isResident && residency.amenity.type === 'couch';
    const lying = isResident && residency.amenity.type === 'bed';
    const amenityRotation = isResident
      ? (() => {
        const rotation = ((residency.amenity.rotation || 0) % 4 + 4) % 4;
        if (lying) return rotation % 2 === 0 ? Math.PI / 2 : 0;
        return rotation * (Math.PI / 2);
      })()
      : 0;
    const walking = !isResident && movement.motion === 'traversing';

    const palette = getCharacterPalette(s);
    drawStickFigure(ctx, x, y, palette.figure, {
      id: s.id,
      seated,
      lying,
      walking,
      cleaning: ['clean_table', 'clean_floor', 'wash_item'].includes(s.task?.type)
        && s.activityPhase === 'working' && !walking,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
      rotation: amenityRotation,
    });
    const amenityTimer = amenity && s.amenityUse?.phase === 'occupied'
      ? getAmenityActivityRemaining(state, s, amenity)
      : null;
    drawVerticalProgress(ctx, x + 14, y - 7,
      amenityTimer ?? (!isResident ? staffProgress(state, s, movement) : null));

    ctx.fillStyle = palette.staffName;
    ctx.font = getCanvasFont('staff');
    ctx.textAlign = 'center';
    const nearbyNames = renderedStaff.filter(pos => (
      Math.abs(pos.x - x) < 40 && Math.abs(pos.y - y) < 30
    )).length;
    ctx.fillText(s.name, x, y - 14 - nearbyNames * 10);
    ctx.textAlign = 'start';
    renderedStaff.push({ x, y });

    const carriedItems = Array.isArray(state.serviceItems)
      ? getCarriedServiceItemIds(s)
        .map(id => state.serviceItems.find(item => item.id === id))
        .filter(Boolean)
      : [];
    carriedItems.forEach((carriedItem, carriedIndex) => {
      ctx.fillStyle = '#fff';
      ctx.font = getCanvasFont('item');
      ctx.fillText(
        getServiceItemEmoji(carriedItem, state.dishes || []),
        x + 12 + carriedIndex * 12,
        y - 14,
      );
    });
  }

  ctx.restore();
}

export function drawCustomerLayer(ctx, state, camera, renderOptions = {}) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  for (const c of state.customers || []) {
    const movement = getCharacterMovementStatus(state, c.id);
    const walking = movement.motion === 'traversing';
    let cx, cy;
    let seatedGeometry = null;
    const table = c.tableId
      ? (state.tables || []).find(candidate => candidate.id === c.tableId)
      : null;
    const chair = c.chairId && table
      ? (state.chairs || []).find(candidate =>
          candidate.id === c.chairId && candidate.tableId === c.tableId)
      : null;
    // Deciding to leave does not mean the customer has physically stood up.
    // Keep the chair-sized pose while departure/checkout waits for a route.
    const waitingInChair = ['leaving', 'checkout_queued', 'checkout_moving'].includes(c.state)
      && c.seatResidency?.phase === 'seated'
      && chair && c.x === chair.x + 10 && c.y === chair.y + 10;
    const seated = waitingInChair
      || ['seated', 'ordering', 'eating', 'waiting_for_items', 'waiting_for_party'].includes(c.state);

    if (seated) {
      seatedGeometry = getSeatedDisplayGeometry(chair, table);
      if (!seatedGeometry) continue;
      ({ x: cx, y: cy } = seatedGeometry.figure);
    } else if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
      cx = c.x;
      cy = c.y - 4;
    } else {
      continue;
    }

    const deciding = (c.state === 'seated' && !c.dishId) || c.state === 'ordering';
    ctx.save();
    ctx.globalAlpha = c.state === 'leaving' && c.exitPhase === 'fading'
      ? Math.max(0, 1 - (c.exitFadeProgress || 0))
      : 1;
    drawStickFigure(ctx, cx, cy, getCharacterPalette(c).figure, {
      seated,
      scale: seated ? 0.7 : 1,
      rotation: 0,
      walking: ['entering', 'leaving'].includes(c.state) && walking,
      id: c.id,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });
    if (deciding) drawMenu(ctx, seatedGeometry.menu);
    drawFoodPatienceMeter(ctx, cx - 7, cy - 28,
      getFoodPatienceFraction(c, state.restaurant?.gameTime));
    const consuming = c.state === 'eating'
      && (!c.navigationGoal || movement.plan === 'arrived');
    drawVerticalProgress(ctx, cx + 14, cy - 7, consuming
      ? getCustomerConsumptionRemainingFraction(
        c,
        state.serviceItems || [],
        state.restaurant?.gameTime,
      )
      : null);
    ctx.restore();
  }

  ctx.restore();
}

export function drawSelectionLayer(ctx, state, camera, selectedItems = []) {
  if (!selectedItems.length) return;
  const selectedTables = new Set(selectedItems.filter(item => item.type === 'table').map(item => item.id));
  const selectedChairs = new Set(selectedItems.filter(item => item.type === 'chair').map(item => item.id));
  const selectedWashStations = new Set(selectedItems.filter(item => item.type === 'washStation').map(item => item.id));
  const selectedAmenities = new Set(selectedItems
    .filter(item => item.type === 'staffAmenity').map(item => item.id));

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.strokeStyle = '#f0a500';
  ctx.lineWidth = 2 / camera.zoom;
  for (const table of state.tables) {
    if (selectedTables.has(table.id)) ctx.strokeRect(table.x - 3, table.y - 3, 46, 46);
  }
  for (const chair of state.chairs) {
    if (selectedChairs.has(chair.id)) ctx.strokeRect(chair.x - 3, chair.y - 3, 26, 26);
  }
  for (const station of state.washStations || []) {
    if (selectedWashStations.has(station.id)) ctx.strokeRect(station.x - 3, station.y - 3, 46, 46);
  }
  for (const amenity of state.staffAmenities || []) {
    if (!selectedAmenities.has(amenity.id)) continue;
    const footprint = getAmenityGeometry(amenity)?.footprint;
    if (footprint) {
      ctx.strokeRect(footprint.x - 3, footprint.y - 3, footprint.w + 6, footprint.h + 6);
    }
  }
  ctx.restore();
}

export function drawOverlayLayer(ctx, state, camera, sprites, tooltipText) {
  if (!tooltipText) return;

  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  const tipWidth = ctx.measureText(tooltipText).width + 16;
  ctx.fillRect(10, ctx.canvas.height - 40, tipWidth, 30);

  ctx.fillStyle = '#fff';
  ctx.font = getCanvasFont('tooltip');
  ctx.fillText(tooltipText, 18, ctx.canvas.height - 20);
}
