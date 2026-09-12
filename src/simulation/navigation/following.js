import { cellToWorld, worldToCell } from '../movement/navigationWorkspace';
import { canClaimDestination } from './destinations';
import { createGrid } from './grid';
import { findRoute } from './router';

export function validFollowerGoal(state, customer, grid = createGrid(state)) {
  return grid.isOpen(customer.navigationGoal) && canClaimDestination(state, customer, customer.navigationGoal);
}

export function chooseFollowerGoal(state, customer, preceding) {
  const grid = createGrid(state);
  const preferred = { x: preceding.x - 12, y: preceding.y + 12 };
  const centre = worldToCell(preceding);
  const candidates = [];
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    candidates.push(cellToWorld({ x: centre.x + dx, y: centre.y + dy }));
  }
  const distance = p => Math.hypot(p.x - preferred.x, p.y - preferred.y);
  candidates.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
  let budget = 256;
  for (const candidate of [preferred, ...candidates]) {
    if (!grid.isOpen(candidate) || !canClaimDestination(state, customer, candidate)
      || Math.hypot(candidate.x - preceding.x, candidate.y - preceding.y) < 16) continue;
    const result = findRoute(grid, customer, candidate, { maxExpansions: budget });
    budget -= result.expansions;
    if (result.status === 'found') return candidate;
    if (budget <= 0) break;
  }
  return null;
}
