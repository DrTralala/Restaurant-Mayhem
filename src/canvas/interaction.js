import { screenToWorld } from './camera';

export function findClickedEntity(state, camera, screenX, screenY) {
  const world = screenToWorld(camera, screenX, screenY);

  for (const table of state.tables) {
    if (world.x >= table.x && world.x <= table.x + 60
      && world.y >= table.y && world.y <= table.y + 40) {
      const customer = state.customers.find(c => c.tableId === table.id);
      return {
        type: 'table',
        data: table,
        text: `Table ${table.id} · ${table.seats} seats · ${table.status}${customer ? ' · ' + customer.archetype : ''}`,
      };
    }
  }

  for (const station of state.kitchenStations) {
    if (world.x >= station.x && world.x <= station.x + 40
      && world.y >= station.y && world.y <= station.y + 40) {
      return {
        type: 'kitchen',
        data: station,
        text: `Station ${station.id} · ${station.equipmentId || 'Empty'}`,
      };
    }
  }

  return null;
}
