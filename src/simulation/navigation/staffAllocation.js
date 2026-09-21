import { createGrid } from './grid';
import { finitePoint, positionAvailable } from './occupancy';
import { getDefaultStaffPosition, getRestaurantWorld, GRID_SIZE } from '../world';

export function allocateStaffPositions(state, workers = state.staff || []) {
  if (workers.every(finitePoint)) return workers;
  const staff = workers.map(worker => ({ ...worker }));
  const world = getRestaurantWorld(state.restaurant || {});
  const grid = createGrid(state);
  const pending = staff.map((worker, index) => ({ worker, index }))
    .filter(({ worker }) => !finitePoint(worker))
    .sort((a, b) => String(a.worker.id) < String(b.worker.id) ? -1 : String(a.worker.id) > String(b.worker.id) ? 1 : 0);
  for (const { worker, index } of pending) {
    const preferred = getDefaultStaffPosition(worker.role, index, state, worker.id);
    const points = [];
    for (let y = Math.ceil(world.diningY / GRID_SIZE) * GRID_SIZE;
      y <= world.kitchenY + world.floorH; y += GRID_SIZE) {
      for (let x = Math.ceil(world.floorX / GRID_SIZE) * GRID_SIZE;
        x < world.doorX; x += GRID_SIZE) points.push({ x, y });
    }
    points.sort((a, b) => Math.hypot(a.x - preferred.x, a.y - preferred.y)
      - Math.hypot(b.x - preferred.x, b.y - preferred.y) || a.y - b.y || a.x - b.x);
    const working = { ...state, staff };
    const point = [preferred, ...points].find(candidate => finitePoint(candidate)
      && candidate.x >= world.floorX && candidate.x < world.doorX
      && candidate.y >= world.diningY && candidate.y <= world.kitchenY + world.floorH
      && grid.isOpen(candidate) && positionAvailable(working, candidate, worker.id, {
        goals: true, actor: worker,
      }));
    if (!point) return null; // Caller must reject atomically; never return a partial allocation.
    staff[index] = { ...worker, x: point.x, y: point.y };
  }
  return staff;
}
