const MENU_WIDTH = 24;
const MENU_HEIGHT = 16;
const MENU_DISTANCE = 10;

export function getSeatedDisplayGeometry(chair, table) {
  if (![chair?.x, chair?.y, table?.x, table?.y].every(Number.isFinite)) return null;
  const chairCentre = { x: chair.x + 10, y: chair.y + 10 };
  const tableCentre = { x: table.x + 20, y: table.y + 20 };
  const dx = tableCentre.x - chairCentre.x;
  const dy = tableCentre.y - chairCentre.y;
  const length = Math.hypot(dx, dy) || 1;
  const menuCentre = {
    x: chairCentre.x + (dx / length) * MENU_DISTANCE,
    y: chairCentre.y + MENU_DISTANCE,
  };
  return {
    figure: { x: chairCentre.x, y: chair.y + 5 },
    menu: {
      x: menuCentre.x - MENU_WIDTH / 2,
      y: menuCentre.y - MENU_HEIGHT / 2,
      width: MENU_WIDTH,
      height: MENU_HEIGHT,
    },
  };
}
