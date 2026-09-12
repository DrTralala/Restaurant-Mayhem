import { describe, expect, it } from 'vitest';
import { canClaimDestination } from './destinations';

describe('destination clearance', () => {
  const actor = { id: 'self', x: 200, y: 200, navigationGoal: { x: 220, y: 200 } };
  it('does not block an actor with its own current position or goal', () => {
    expect(canClaimDestination({ staff: [actor] }, actor, actor)).toBe(true);
    expect(canClaimDestination({ staff: [actor] }, actor, actor.navigationGoal)).toBe(true);
  });
  it.each([0, 15, 15.999])('rejects another active destination at distance %s', distance => {
    const peer = { id: 'peer', x: 400, y: 400, navigationGoal: { x: 220 + distance, y: 200 } };
    expect(canClaimDestination({ staff: [actor, peer] }, actor, actor.navigationGoal)).toBe(false);
  });
  it('allows destinations separated by the full required clearance', () => {
    expect(canClaimDestination({ customers: [{ id: 'peer', x: 236, y: 200 }] }, actor, actor.navigationGoal)).toBe(true);
  });
  it('respects stationary customer positions and queue leases', () => {
    expect(canClaimDestination({ customers: [{ id: 'peer', x: 220, y: 200 }] }, actor, actor.navigationGoal)).toBe(false);
    expect(canClaimDestination({ queueSlots: [{ memberId: 'peer', x: 220, y: 200 }] }, actor, actor.navigationGoal)).toBe(false);
  });
  it.each([null, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }])('rejects an invalid target %j', point => {
    expect(canClaimDestination({}, actor, point)).toBe(false);
  });
});
