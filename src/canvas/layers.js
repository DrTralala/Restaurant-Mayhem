import { getDoors, getRestaurantWorld, getQueuePosition, getDefaultStaffPosition } from '../simulation/world';
import { getTableNumber } from './tableLabels';
import { getCharacterPalette } from './characterAppearance';

function animationOffset(id = '') {
  return [...String(id)].reduce((total, character) => total + character.charCodeAt(0), 0) * 0.17;
}

function drawStickFigure(ctx, x, y, color, { seated = false, walking = false, cleaning = false, timeMs = 0, reducedMotion = false, id = '' } = {}) {
  const stride = walking && !cleaning && !reducedMotion
    ? Math.sin(timeMs * 0.012 + animationOffset(id)) * 4
    : 0;
  const wipe = cleaning && !reducedMotion
    ? Math.sin(timeMs * 0.012 + animationOffset(id)) * 5
    : 0;
  const leftHandX = cleaning ? x + 3 + wipe : x - 8;
  const rightHandX = cleaning ? x + 9 + wipe : x + 8;
  const handY = cleaning ? y + 12 : y + 10;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  ctx.lineTo(x, y + 14);
  ctx.moveTo(x, y + 7);
  ctx.lineTo(leftHandX, handY + stride);
  ctx.moveTo(x, y + 7);
  ctx.lineTo(rightHandX, handY - stride);
  ctx.moveTo(x, y + 14);
  ctx.lineTo(x - 6, seated ? y + 15 : y + 22 - stride);
  ctx.moveTo(x, y + 14);
  ctx.lineTo(x + 6, seated ? y + 15 : y + 22 + stride);
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
}

function drawMenu(ctx, x, y) {
  ctx.fillStyle = '#f3e6bd';
  ctx.fillRect(x - 9, y + 3, 18, 12);
  ctx.strokeStyle = '#8f7648';
  ctx.lineWidth = 1;
  ctx.strokeRect(x - 9, y + 3, 18, 12);
  ctx.beginPath();
  ctx.moveTo(x, y + 4);
  ctx.lineTo(x, y + 14);
  ctx.stroke();
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

    const tableNumber = getTableNumber(table.id);
    if (tableNumber != null) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`Table ${tableNumber}`, tx + 2, ty + 10);
    }
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
        ctx.font = '8px monospace';
        ctx.fillText(eq.name, station.x + 8, station.y + 25);
      }
    }
  }

  // Service tables (long counter between kitchen and dining)
  for (const st of state.serviceTables) {
    ctx.fillStyle = '#4a6a4a';
    ctx.fillRect(st.x, st.y, 120, 40);
    ctx.fillStyle = '#aaa';
    ctx.font = '8px monospace';
    ctx.fillText('SERVICE', st.x + 30, st.y + 24);
  }

  // Food items
  for (const food of state.foodItems) {
    if (food.state === 'to_clean') continue;
    const dish = state.dishes.find(d => d.id === food.dishId);
    const label = dish ? dish.name.substring(0, 6) : 'food';
    ctx.fillStyle = food.state === 'on_service' ? '#f0a500' : '#4a7';
    ctx.fillRect(food.x, food.y, 24, 12);
    ctx.fillStyle = '#111';
    ctx.font = '7px monospace';
    ctx.fillText(label, food.x + 2, food.y + 10);
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
      : getDefaultStaffPosition(s.role, index, state);
    const x = pos.x, y = pos.y;

    const palette = getCharacterPalette(s);
    drawStickFigure(ctx, x, y, palette.figure, {
      id: s.id,
      walking: Boolean(s.path?.length),
      cleaning: s.task?.type === 'clean_table' && !s.path?.length,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });

    ctx.fillStyle = palette.staffName;
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    const nearbyNames = renderedStaff.filter(pos => (
      Math.abs(pos.x - x) < 40 && Math.abs(pos.y - y) < 30
    )).length;
    ctx.fillText(s.name, x, y - 14 - nearbyNames * 10);
    ctx.textAlign = 'start';
    renderedStaff.push({ x, y });

    if (s.carryingFoodId) {
      ctx.fillStyle = '#f0a500';
      ctx.font = 'bold 7px monospace';
      ctx.fillText('F', x + 12, y - 14);
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
    const seated = ['seated', 'ordering', 'eating'].includes(c.state);
    const tableChairs = c.tableId
      ? (state.chairs || []).filter(chair => chair.tableId === c.tableId)
      : [];
    const tableCustomers = c.tableId
      ? state.customers.filter(customer => customer.tableId === c.tableId && ['seated', 'ordering', 'eating', 'paying'].includes(customer.state))
      : [];
    const chair = c.chairId
      ? tableChairs.find(candidate => candidate.id === c.chairId)
      : tableChairs[tableCustomers.findIndex(customer => customer.id === c.id)] || null;

    if (seated && chair) {
      cx = chair.x + 10;
      cy = chair.y + 10;
    } else if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
      cx = c.x;
      cy = c.y;
    } else if (c.tableId) {
      const table = state.tables.find(t => t.id === c.tableId);
      if (!table) continue;
      cx = table.x + 20;
      cy = table.y + 20;
    } else {
      continue;
    }

    const deciding = (c.state === 'seated' && !c.dishId) || c.state === 'ordering';
    drawStickFigure(ctx, cx, cy, getCharacterPalette(c).figure, {
      seated,
      walking: (c.state === 'guided' || c.state === 'leaving') && Boolean(c.path?.length),
      id: c.id,
      timeMs: renderOptions.timeMs,
      reducedMotion: renderOptions.reducedMotion,
    });
    if (deciding) drawMenu(ctx, cx, cy);
  }

  ctx.restore();
}

export function drawSelectionLayer(ctx, state, camera, selectedItems = []) {
  if (!selectedItems.length) return;
  const selectedTables = new Set(selectedItems.filter(item => item.type === 'table').map(item => item.id));
  const selectedChairs = new Set(selectedItems.filter(item => item.type === 'chair').map(item => item.id));

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
