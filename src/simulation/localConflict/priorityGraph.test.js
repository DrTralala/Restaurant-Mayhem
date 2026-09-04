import { expect, it } from 'vitest';
import { addPriorityEdge, orderActorsByMovementPriority } from './priorityGraph';

it('orders same-door egress before ingress, then age and ID', () => {
  const actors = [
    { id: 'a-in', stalledFor: 5, doorId: 'front', doorFlow: 'in' },
    { id: 'z-out', stalledFor: 0, doorId: 'front', doorFlow: 'out' },
    { id: 'b-free', stalledFor: 2 },
  ];
  expect(orderActorsByMovementPriority(actors).map(actor => actor.id))
    .toEqual(['b-free', 'z-out', 'a-in']);
});

it('rejects only edges that would create a cycle', () => {
  const actors = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const edges = [['a', 'b'], ['b', 'c']];
  expect(addPriorityEdge(actors, edges, 'c', 'a')).toBeNull();
  expect(addPriorityEdge(actors, edges, 'a', 'c')).toEqual([...edges, ['a', 'c']]);
  expect(addPriorityEdge(actors, edges, 'a', 'b')).toBe(edges);
});
