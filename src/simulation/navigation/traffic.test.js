import { describe, expect, it } from 'vitest';
import { arbitrateDestinations, compareTraffic, orderTrafficRequests } from './traffic';

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

  it('keeps the front customer ahead of a rear customer in one checkout queue', () => {
    const front = request('front', 400, 300, {
      checkoutStationId: 'register', queueRank: 0, waitingTicks: 0,
    });
    const rear = request('rear', 500, 300, {
      checkoutStationId: 'register', queueRank: 1, waitingTicks: 1000,
    });

    expect(orderTrafficRequests([rear, front]).map(item => item.id)).toEqual(['front', 'rear']);
  });

  it('keeps mixed checkout arbitration deterministic for every input order', () => {
    const front = request('z', 400, 300, {
      checkoutStationId: 'register', queueRank: 0,
    });
    const rear = request('a', 400, 300, {
      checkoutStationId: 'register', queueRank: 1,
    });
    const unrelated = request('m', 400, 300);
    const permutations = [
      [front, rear, unrelated],
      [front, unrelated, rear],
      [rear, front, unrelated],
      [rear, unrelated, front],
      [unrelated, front, rear],
      [unrelated, rear, front],
    ];

    const sortedOrders = permutations.map(items => items.slice().sort(compareTraffic).map(item => item.id));
    expect(new Set(sortedOrders.map(order => JSON.stringify(order))).size).toBe(1);

    const ordered = orderTrafficRequests([rear, unrelated, front]).map(item => item.id);
    expect(ordered.indexOf('z')).toBeLessThan(ordered.indexOf('a'));

    const claimedIds = permutations.map(items => [...arbitrateDestinations(items).claims.keys()]);
    expect(new Set(claimedIds.map(ids => JSON.stringify(ids))).size).toBe(1);
  });

  it('does not let callers mutate an acquired claim through their request', () => {
    const item = request('a', 400, 300);
    const { claims } = arbitrateDestinations([item]);
    item.goal.x = 900;
    expect(claims.get('a')).toEqual({ x: 400, y: 300 });
  });

  it('expires historical ownership preference after two movement seconds', () => {
    const previousClaims = new Map([['z-owner', { x: 400, y: 300 }]]);
    const owner = request('z-owner', 400, 300, { waitingSeconds: 1.9, speed: 1 });
    const challenger = request('a-challenger', 400, 300, { speed: 1 });
    expect([...arbitrateDestinations([owner, challenger], previousClaims).claims.keys()])
      .toEqual(['z-owner']);

    const expired = { ...owner, waitingSeconds: 2 };
    expect([...arbitrateDestinations([expired, challenger], previousClaims).claims.keys()])
      .toEqual(['a-challenger']);
  });

  it('does not claim a remote endpoint for a zero-speed actor but keeps at-goal occupancy', () => {
    const remote = request('remote', 400, 300, { speed: 0 });
    expect(arbitrateDestinations([remote]).claims.size).toBe(0);

    const atGoal = request('at-goal', 400, 300, { start: { x: 400, y: 300 }, speed: 0 });
    expect([...arbitrateDestinations([atGoal]).claims.keys()]).toEqual(['at-goal']);
  });

  it('does not retain an unreachable owner and keeps legacy speed omission compatible', () => {
    const previousClaims = new Map([['z-owner', { x: 400, y: 300 }]]);
    const unreachable = request('z-owner', 400, 300, { previousPlan: 'unreachable', speed: 1 });
    const challenger = request('a-challenger', 400, 300, { speed: 1 });
    expect([...arbitrateDestinations([unreachable, challenger], previousClaims).claims.keys()])
      .toEqual(['a-challenger']);

    const legacy = request('z-owner', 400, 300);
    delete legacy.speed;
    expect([...arbitrateDestinations([legacy, challenger], previousClaims).claims.keys()])
      .toEqual(['z-owner']);
  });
});
