import { describe, expect, it } from 'vitest';
import { arbitrateDestinations, compareTraffic } from './traffic';

const request = (id, x, y, extra = {}) => ({ id, goal: { x, y }, start: { x: x - 100, y },
  priority: 2, waitingTicks: 0, ...extra });

describe('destination ownership and traffic priority', () => {
  it('grants one overlapping exclusive destination deterministically', () => {
    const requests = [request('b', 400, 300), request('a', 410, 300)];
    const forward = arbitrateDestinations(requests);
    expect([...forward.claims.keys()]).toEqual(['a']);
    expect(forward.blocked.get('b')).toEqual(['a']);
    expect(arbitrateDestinations([...requests].reverse())).toEqual(forward);
  });

  it('retains a physically occupied terminal until its owner releases it', () => {
    const requests = [request('waiting', 400, 300, { waitingTicks: 1000 }),
      request('owner', 400, 300, { start: { x: 400, y: 300 } })];
    const result = arbitrateDestinations(requests);
    expect([...result.claims.keys()]).toEqual(['owner']);
    expect([...arbitrateDestinations([requests[0]], result.claims).claims.keys()]).toEqual(['waiting']);
  });

  it('does not allow optional roaming to retain a productive destination', () => {
    const idle = request('idle', 400, 300, { priority: 4 });
    const claims = arbitrateDestinations([idle]).claims;
    const result = arbitrateDestinations([idle, request('work', 400, 300)], claims);
    expect([...result.claims.keys()]).toEqual(['work']);
  });

  it('does not steal an in-progress productive claim as waiting priority ages', () => {
    const leader = request('leader', 1113, 360, { start: { x: 1032, y: 360 }, priority: 0 });
    const claims = arbitrateDestinations([leader]).claims;
    const follower = request('follower', 1113, 360, { start: { x: 993, y: 360 }, priority: 0, waitingTicks: 300 });
    expect([...arbitrateDestinations([follower, leader], claims).claims.keys()]).toEqual(['leader']);
    expect([...arbitrateDestinations([follower], claims).claims.keys()]).toEqual(['follower']);
  });

  it('keeps non-overlapping claims at exactly sixteen pixels', () => {
    expect(arbitrateDestinations([request('a', 400, 300), request('b', 416, 300)]).claims.size).toBe(2);
  });

  it('uses waiting age to prevent a permanently lower planning priority', () => {
    const waiting = request('old', 400, 300, { priority: 4, waitingTicks: 300 });
    const fresh = request('new', 500, 300, { priority: 0 });
    expect(compareTraffic(waiting, fresh)).toBeLessThan(0);
  });

  it('does not let callers mutate an acquired claim through their request', () => {
    const item = request('a', 400, 300);
    const { claims } = arbitrateDestinations([item]);
    item.goal.x = 900;
    expect(claims.get('a')).toEqual({ x: 400, y: 300 });
  });
});
