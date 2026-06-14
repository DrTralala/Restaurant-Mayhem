export function loadSprites() {
  return {};
}

export function drawSprite(ctx, sprites, key, x, y, size) {
  const colors = {
    table: '#8B4513',
    chair: '#A0522D',
    customer: '#4A90D9',
    cook: '#D94A4A',
    waiter: '#4AD94A',
    host: '#D9D94A',
    kitchen: '#666',
    equipment: '#888',
  };
  ctx.fillStyle = colors[key] || '#999';
  ctx.fillRect(x, y, size || 20, size || 20);
}
