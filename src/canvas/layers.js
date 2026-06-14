export function drawFloorLayer(ctx, state, camera) {
  const { restaurant } = state;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  // Dining area
  ctx.fillStyle = '#2d1f0e';
  ctx.fillRect(50, 100, 500, 400);

  // Kitchen area
  ctx.fillStyle = '#333';
  ctx.fillRect(50, 50, 500, 50);

    // Wall
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 3;
    ctx.strokeRect(50, 50, 500, 450);

    // Door gap in wall (right side)
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(547, 300, 6, 40);

    // Queue area outside the door
    ctx.fillStyle = '#252530';
    ctx.fillRect(560, 100, 120, 400);
    ctx.strokeStyle = '#444';
    ctx.strokeRect(560, 100, 120, 400);
    ctx.fillStyle = '#888';
    ctx.font = '9px monospace';
    ctx.fillText('QUEUE', 600, 115);

    ctx.restore();
}

export function drawQueueLayer(ctx, state, camera) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  const archetypeColors = {
    regular: '#4A90D9',
    foodie: '#D9A44A',
    rusher: '#D94A4A',
    influencer: '#9B4AD9',
  };

  for (let i = 0; i < state.queue.length; i++) {
    const q = state.queue[i];
    const y = 500 - i * 25;

    ctx.fillStyle = archetypeColors[q.archetype] || '#999';
    ctx.beginPath();
    ctx.arc(620, y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.font = '8px monospace';
    ctx.fillText('waiting', 630, y + 3);
  }

  ctx.restore();
}

export function drawFurnitureLayer(ctx, state, camera) {
  ctx.save();
  ctx.translate(camera.x, camera.y);
  ctx.scale(camera.zoom, camera.zoom);

  for (const table of state.tables) {
    const color = table.status === 'dirty' ? '#663333'
      : table.status === 'occupied' ? '#4a6741' : '#6b5b3a';
    ctx.fillStyle = color;
    ctx.fillRect(table.x, table.y, 60, 40);

    ctx.fillStyle = '#aaa';
    ctx.font = '10px monospace';
    ctx.fillText(`Table ${table.id}`, table.x + 8, table.y + 25);
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
    ctx.arc(table.x + 30, table.y + 20, 8, 0, Math.PI * 2);
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
