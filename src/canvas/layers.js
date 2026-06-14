export function drawFloorLayer(ctx, state, camera) {
  const { restaurant } = state;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const level = restaurant.expansionLevel || 1;
  const areaW = 400 + (level - 1) * 150;
  const areaH = 350 + (level - 1) * 100;

  // Dining area
  ctx.fillStyle = '#2d1f0e';
  ctx.fillRect(50, 100, areaW + 100, areaH + 50);

  // Grid lines in dining area
  ctx.strokeStyle = 'rgba(80,80,80,0.3)';
  ctx.lineWidth = 0.5;
  for (let gx = 60; gx < 50 + areaW + 100; gx += 20) {
    ctx.beginPath();
    ctx.moveTo(gx, 100);
    ctx.lineTo(gx, 100 + areaH + 50);
    ctx.stroke();
  }
  for (let gy = 100; gy < 100 + areaH + 50; gy += 20) {
    ctx.beginPath();
    ctx.moveTo(60, gy);
    ctx.lineTo(60 + areaW + 90, gy);
    ctx.stroke();
  }

  // Kitchen area (stretches with expansion)
  ctx.fillStyle = '#333';
  ctx.fillRect(50, 50, areaW + 100, 50);

  // Wall
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 3;
  ctx.strokeRect(50, 50, areaW + 100, areaH + 100);

    // Door gap in wall (right side)
    const doorX = 50 + areaW + 100 - 3;
    const doorY = areaH / 2 + 80;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(doorX, doorY, 6, 40);

    // Cashier stand near the door
    ctx.fillStyle = '#5a4a3a';
    ctx.fillRect(doorX - 8, doorY - 20, 14, 20);
    ctx.fillStyle = '#8a7a6a';
    ctx.fillRect(doorX - 5, doorY - 18, 8, 16);
    ctx.fillStyle = '#ccc';
    ctx.font = '7px monospace';
    ctx.fillText('$', doorX - 1, doorY - 8);

    // Queue area outside the door
  const queueX = doorX + 6;
  ctx.fillStyle = '#252530';
  ctx.fillRect(queueX, 100, 120, 400);
  ctx.strokeStyle = '#444';
  ctx.strokeRect(queueX, 100, 120, 400);
  ctx.fillStyle = '#888';
  ctx.font = '9px monospace';
  ctx.fillText('QUEUE', queueX + 5, 115);

  ctx.restore();
}

export function drawQueueLayer(ctx, state, camera) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const level = state.restaurant.expansionLevel || 1;
  const areaH = 350 + (level - 1) * 100;
  const doorX = 50 + (400 + (level - 1) * 150) + 100 - 3;

  const archetypeColors = {
    regular: '#4A90D9',
    foodie: '#D9A44A',
    rusher: '#D94A4A',
    influencer: '#9B4AD9',
  };

  const MAX_VISIBLE = 8;
  const visible = Math.min(state.queue.length, MAX_VISIBLE);
  for (let i = 0; i < visible; i++) {
    const q = state.queue[i];
    const y = areaH + 50 - i * 25;

    ctx.fillStyle = archetypeColors[q.archetype] || '#999';
    ctx.beginPath();
    ctx.arc(doorX + 50, y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '8px monospace';
    ctx.fillText('waiting', doorX + 62, y + 3);
  }

  if (state.queue.length > MAX_VISIBLE) {
    const extra = state.queue.length - MAX_VISIBLE;
    const labelY = areaH + 50 - MAX_VISIBLE * 25 - 14;
    ctx.fillStyle = '#f0a500';
    ctx.font = 'bold 10px monospace';
    ctx.fillText(`+${extra} more`, doorX + 50, labelY);
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

    ctx.fillStyle = '#aaa';
    ctx.font = '9px monospace';
    ctx.fillText(`T${table.id}`, tx + 6, ty + 23);
  }

  // Chairs (drawn from chairs array — independently movable, rotatable)
  for (const chair of state.chairs) {
    ctx.fillStyle = '#5a4a30';
    ctx.fillRect(chair.x, chair.y, 20, 20);
    // Rotation indicator: small dot on the facing side
    ctx.fillStyle = '#8a7a5a';
    const rot = chair.rotation || 0;
    const cx = chair.x + 10, cy = chair.y + 10;
    const dirs = [
      [0, -8],   // 0: up
      [8, 0],    // 1: right
      [0, 8],    // 2: down
      [-8, 0],   // 3: left
    ];
    const [dx, dy] = dirs[rot];
    ctx.fillRect(cx + dx - 2, cy + dy - 2, 4, 4);
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

export function drawStaffLayer(ctx, state, camera) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  for (const s of state.staff) {
    let x = 100, y = 100;
    if (s.role === 'cook') { x = 70 + state.staff.indexOf(s) * 50; y = 70; }
    else if (s.role === 'waiter') { x = 300; y = 300; }
    else if (s.role === 'host') { x = 520; y = 100; }

    const color = s.morale > 50 ? '#4a7' : '#a44';
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '8px monospace';
    ctx.fillText(s.name, x - 10, y - 14);
  }

  ctx.restore();
}

export function drawCustomerLayer(ctx, state, camera) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const archetypeColors = {
    regular: '#4A90D9',
    foodie: '#D9A44A',
    rusher: '#D94A4A',
    influencer: '#9B4AD9',
  };

  for (const c of state.customers) {
    if (!c.tableId) continue;
    const table = state.tables.find(t => t.id === c.tableId);
    if (!table) continue;

    ctx.fillStyle = archetypeColors[c.archetype] || '#999';
    ctx.beginPath();
    ctx.arc(table.x + 20, table.y + 20, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '8px monospace';
    ctx.fillText(c.state, table.x + 5, table.y + 32);
  }

  ctx.restore();
}

export function drawOverlayLayer(ctx, state, camera, tooltipText) {
  if (!tooltipText) return;

  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  const tipWidth = ctx.measureText(tooltipText).width + 16;
  ctx.fillRect(10, ctx.canvas.height - 40, tipWidth, 30);

  ctx.fillStyle = '#fff';
  ctx.font = '12px monospace';
  ctx.fillText(tooltipText, 18, ctx.canvas.height - 20);
}
