import { getDoors, getRestaurantWorld, getQueuePosition, getDefaultStaffPosition } from '../simulation/world';
import { getPlacementRect } from '../simulation/placement';
import { getCharacterPalette } from './characterAppearance';
import { getServiceItemEmoji } from './serviceItemEmoji';
import { getPlaceSettingPositions } from './tableGeometry';
import { ACTIVITY_DURATIONS, getRemainingFraction } from '../simulation/activity';
import { getUpgradeEffect } from '../simulation/balance';
import { getWashStationCapacity, getWashStationOccupancy } from '../simulation/dishwashing';

function drawVerticalProgress(ctx, x, y, remaining) {
  if (!Number.isFinite(remaining)) return;
  const height = 14;
  const filled = height * Math.min(1, Math.max(0, remaining));
  ctx.save(); ctx.strokeStyle = '#8a6a00'; ctx.strokeRect(x, y, 3, height);
  ctx.fillStyle = '#ffd400'; ctx.fillRect(x + 1, y + height - filled, 1, filled); ctx.restore();
}

function staffProgress(state, staff) {
  if (!staff.task || staff.path?.length) return null;
  let duration = { take_order: ACTIVITY_DURATIONS.takeOrder, take_payment: ACTIVITY_DURATIONS.takePayment,
    clean_floor: ACTIVITY_DURATIONS.wipeFloor, wash_item: ACTIVITY_DURATIONS.manualWash }[staff.task.type];
  let started = staff.task.startedAt ?? staff.task.cleaningStartedAt ?? staff.task.washingStartedAt;
  const item = (state.serviceItems || []).find(candidate => candidate.id === staff.task.serviceItemId);
  if (staff.task.type === 'prepare_drink') duration = ACTIVITY_DURATIONS.prepareDrink;
  if (staff.task.type === 'prepare_dish') {
    const dish = (state.dishes || []).find(candidate => candidate.id === item?.menuItemId);
    const station = (state.kitchenStations || []).find(candidate => candidate.id === staff.task.stationId);
    const equipment = (state.equipment || []).find(candidate => candidate.id === station?.equipmentId);
    duration = (dish?.prepTime || 60) / ((equipment?.speedMultiplier || 1)
      * (1 + getUpgradeEffect(state, 'globalSpeed')));
  }
  if (item?.preparationStartedAt != null) started = item.preparationStartedAt;
  return getRemainingFraction(state.restaurant?.gameTime, started, duration);
}

function animationOffset(id = '') {
  return [...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.17;
}

function drawStickFigure(ctx, x, y, color, { seated = false, walking = false, cleaning = false, timeMs = 0, reducedMotion = false, id = '', scale = 1, rotation = 0 } = {}) {
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

function drawMenu(ctx, x, y) {
  const left = x - 12;
  const top = y + 1;
  ctx.save();
  ctx.fillStyle = '#f3e6bd';
  ctx.strokeStyle = '#4d3a1f';
  ctx.lineWidth = 1.5;
  ctx.fillRect(left, top, 24, 16);
  ctx.strokeRect(left, top, 24, 16);
  ctx.beginPath();
  ctx.moveTo(x, top + 1);
  ctx.lineTo(x, top + 15);
  ctx.moveTo(left + 3, top + 5);
  ctx.lineTo(x - 3, top + 5);
  ctx.moveTo(x + 3, top + 5);
  ctx.lineTo(left + 21, top + 5);
  ctx.stroke();
  ctx.restore();
}

export function drawFloorLayer(ctx, state, camera) {
  const { restaurant } = state;
  const world = getRestaurantWorld(restaurant);

  ctx.fillStyle = '#000000';
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
      ctx.fillStyle = '#eee';
      ctx.font = 'bold 8px monospace';
      ctx.fillText('$ CASHIER', cashier.x + 12, cashier.y + 23);
    }

    // Queue area outside the door
  ctx.fillStyle = '#252530';
  ctx.fillRect(world.queueX, world.queueY, world.queueW, world.queueH);
  ctx.strokeStyle = '#444';
  ctx.strokeRect(world.queueX, world.queueY, world.queueW, world.queueH);
  ctx.fillStyle = '#888';
  ctx.font = '9px monospace';
  ctx.fillText('QUEUE', world.queueX + 5, world.queueY + 15);

  ctx.restore();
}

export function drawQueueLayer(ctx, state, camera, renderOptions = {}) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const world = getRestaurantWorld(state.restaurant);

  const MAX_VISIBLE = 8;
  const visible = Math.min(state.queue.length, MAX_VISIBLE);
  for (let i = 0; i < visible; i++) {
    const q = state.queue[i];
    const pos = getQueuePosition(state, i);

    drawStickFigure(ctx, pos.x, pos.y, getCharacterPalette(q).figure, {
      id: q.id,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });

  }

  if (state.queue.length > MAX_VISIBLE) {
    const extra = state.queue.length - MAX_VISIBLE;
    const lastPos = getQueuePosition(state, MAX_VISIBLE - 1);
    const labelY = lastPos.y - 14;
    ctx.fillStyle = '#f0a500';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`+${extra} more`, world.doorX + 50, labelY);
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
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrows[rot] || arrows[0], cx, cy);
    ctx.restore();
  }

  for (const station of state.kitchenStations) {
    ctx.fillStyle = '#555';
    ctx.fillRect(station.x, station.y, 40, 40);
    if (station.equipmentId) {
      const eq = state.equipment.find(e => e.id === station.equipmentId);
      ctx.fillStyle = '#888';
      ctx.fillRect(station.x + 5, station.y + 5, 30, 30);
      if (eq) {
        ctx.fillStyle = '#fff';
        let fontSize = 8;
        do {
          ctx.font = `${fontSize}px monospace`;
          fontSize -= 1;
        } while (fontSize >= 5 && ctx.measureText(eq.name).width > 26);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(eq.name, station.x + 20, station.y + 20);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  // Service tables (long counter between kitchen and dining)
  for (const st of state.serviceTables) {
    ctx.fillStyle = '#4a6a4a';
    ctx.fillRect(st.x, st.y, 120, 40);
    ctx.fillStyle = '#aaa';
     ctx.font = '8px monospace';
     ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     ctx.fillText('SERVICE', st.x + 60, st.y + 20);
     ctx.textAlign = 'start';
     ctx.textBaseline = 'alphabetic';
  }

  ctx.font = '10px sans-serif';
  for (const dirt of state.floorDirt || []) {
    if (Number.isFinite(dirt.x) && Number.isFinite(dirt.y)) ctx.fillText('💦', dirt.x - 5, dirt.y + 5);
  }
  for (const station of state.washStations || []) {
    const w = station.w || 40, h = station.h || 40;
    ctx.fillStyle = station.type === 'automatic' ? '#536b75' : '#466b62';
    ctx.fillRect(station.x, station.y, w, h); ctx.strokeStyle = '#9ab0aa'; ctx.strokeRect(station.x, station.y, w, h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(station.type === 'automatic' ? 'AUTO' : 'SINK', station.x + w / 2, station.y + h / 2);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    const items = (state.serviceItems || []).filter(item => item.washStationId === station.id
      && ['queued_for_wash', 'washing'].includes(item.state));
    ctx.fillText(`${getWashStationOccupancy(state, station)} / ${getWashStationCapacity(station)}`,
      station.x + w / 2, station.y + h + 10);
    ctx.textAlign = 'start';
    const active = items.find(item => item.state === 'washing');
    if (active) drawVerticalProgress(ctx, station.x + w + 2, station.y + 18,
      getRemainingFraction(state.restaurant?.gameTime, active.washStartedAt,
        station.type === 'automatic' ? ACTIVITY_DURATIONS.automaticWash : ACTIVITY_DURATIONS.manualWash));
  }

  for (const item of Array.isArray(state.serviceItems) ? state.serviceItems : []) {
    if (!['on_service', 'delivered'].includes(item.state)
      || !Number.isFinite(item.x) || !Number.isFinite(item.y)) continue;
    ctx.fillStyle = '#fff';
     ctx.font = '10px sans-serif';
     if (item.state === 'delivered') {
       const customer = (state.customers || []).find(candidate => candidate.id === item.customerId);
       const chair = customer && (state.chairs || []).find(candidate => candidate.id === customer.chairId);
       const table = customer && (state.tables || []).find(candidate => candidate.id === customer.tableId);
       if (chair && table) {
         const kinds = [...new Set((state.serviceItems || [])
           .filter(candidate => candidate.customerId === item.customerId && candidate.state === 'delivered')
           .map(candidate => candidate.kind))];
         const positions = getPlaceSettingPositions(table, chair, kinds);
         const position = positions[item.kind];
          if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
            ctx.fillText(getServiceItemEmoji(item, state.dishes || []), position.x, position.y);
            continue;
          }
          continue;
        }
     }
    ctx.fillText(getServiceItemEmoji(item, state.dishes || []), item.x, item.y);
  }

  ctx.restore();
}

export function drawPlacementPreview(ctx, state, camera, placement) {
  void state;
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
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrows[rotation], rect.x + rect.w / 2, rect.y + rect.h / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  } else if (placement.itemType === 'cashierTable') {
    ctx.fillStyle = '#eee';
    ctx.font = 'bold 8px monospace';
    ctx.fillText('$ CASHIER', rect.x + 12, rect.y + 23);
  } else if (placement.itemType === 'serviceTable') {
    ctx.fillStyle = '#ddd';
    ctx.font = '8px monospace';
     ctx.textAlign = 'center';
     ctx.textBaseline = 'middle';
     ctx.fillText('SERVICE', rect.x + rect.w / 2, rect.y + rect.h / 2);
     ctx.textAlign = 'start';
     ctx.textBaseline = 'alphabetic';
  }

  ctx.restore();
}

export function drawStaffLayer(ctx, state, camera, renderOptions = {}) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const renderedStaff = [];
  for (const [index, s] of state.staff.entries()) {
    const hasCoords = Number.isFinite(s.x) && Number.isFinite(s.y);
    const pos = hasCoords
      ? { x: s.x, y: s.y }
      : getDefaultStaffPosition(s.role, index, state, s.id);
    const x = pos.x, y = pos.y;

    const palette = getCharacterPalette(s);
    drawStickFigure(ctx, x, y, palette.figure, {
      id: s.id,
      walking: Boolean(s.path?.length),
      cleaning: ['clean_table', 'clean_floor', 'wash_item'].includes(s.task?.type) && !s.path?.length,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });
    drawVerticalProgress(ctx, x + 14, y - 7, staffProgress(state, s));

    ctx.fillStyle = palette.staffName;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    const nearbyNames = renderedStaff.filter(pos => (
      Math.abs(pos.x - x) < 40 && Math.abs(pos.y - y) < 30
    )).length;
    ctx.fillText(s.name, x, y - 14 - nearbyNames * 10);
    ctx.textAlign = 'start';
    renderedStaff.push({ x, y });

    const carriedItem = Array.isArray(state.serviceItems)
      ? state.serviceItems.find(item => item.id === s.carryingServiceItemId)
      : null;
    if (carriedItem) {
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.fillText(getServiceItemEmoji(carriedItem, state.dishes || []), x + 12, y - 14);
    }
  }

  ctx.restore();
}

export function drawCustomerLayer(ctx, state, camera, renderOptions = {}) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  for (const c of state.customers) {
    let cx, cy;
    const seated = ['seated', 'ordering', 'eating', 'waiting_for_items'].includes(c.state);
    const tableExists = c.tableId
      && (state.tables || []).some(table => table.id === c.tableId);
    const chair = c.chairId && tableExists
      ? (state.chairs || []).find(candidate =>
          candidate.id === c.chairId && candidate.tableId === c.tableId)
      : null;

    if (seated) {
      if (!chair) continue;
      cx = chair.x + 10;
      cy = chair.y + 10;
    } else if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
      cx = c.x;
      cy = c.y;
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
      walking: c.state === 'leaving'
        ? !renderOptions.reducedMotion
        : c.state === 'guided' && Boolean(c.path?.length),
      id: c.id,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });
    if (deciding) drawMenu(ctx, cx, cy);
    const consuming = c.state === 'eating' && !c.path?.length;
    drawVerticalProgress(ctx, cx + 14, cy - 7, consuming
      ? getRemainingFraction(state.restaurant?.gameTime, c.consumptionStartedAt, c.consumptionDuration)
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
  ctx.restore();
}

export function drawOverlayLayer(ctx, state, camera, sprites, tooltipText) {
  if (!tooltipText) return;

  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  const tipWidth = ctx.measureText(tooltipText).width + 16;
  ctx.fillRect(10, ctx.canvas.height - 40, tipWidth, 30);

  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.fillText(tooltipText, 18, ctx.canvas.height - 20);
}
