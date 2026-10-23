import { afterEach, describe, expect, it, vi } from 'vitest';
import { getQueuePatienceSummary } from './queuePatienceSummary';

let nextMemberId = 0;
const member = (remaining, maximum, overrides = {}) => ({
  id: `m${++nextMemberId}`,
  queuePatience: remaining,
  queuePatienceMax: maximum,
  ...overrides,
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getQueuePatienceSummary', () => {
  it('returns an empty list for an absent or empty queue', () => {
    expect(getQueuePatienceSummary({})).toEqual([]);
    expect(getQueuePatienceSummary({ queue: [] })).toEqual([]);
    expect(getQueuePatienceSummary({ queue: undefined })).toEqual([]);
  });

  it('fractions the lowest-remaining guest over its own maximum', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(10, 20), member(20, 100)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'known', fraction: 0.5, exhaustionSeconds: 10 },
    ]);
  });

  it('uses the maximum across all tied lowest-remaining guests', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(10, 20), member(10, 100)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'known', fraction: 0.1, exhaustionSeconds: 10 },
    ]);
  });

  it('reports unknown when any remaining patience is not finite', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(50, 100), member(NaN, 100)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'unknown', fraction: null, exhaustionSeconds: null },
    ]);
  });

  it('reports exhausted for a known zero or negative remaining value, overriding unknown members', () => {
    expect(getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(0, 20), member(NaN, 100)] }],
    })).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'exhausted', fraction: 0, exhaustionSeconds: 0 },
    ]);
    expect(getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(-1, 20), member(50, 100)] }],
    })).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'exhausted', fraction: 0, exhaustionSeconds: 0 },
    ]);
  });

  it('reports unknown when the lowest-remaining guest has an invalid maximum', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(10, 0), member(20, 100)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'unknown', fraction: null, exhaustionSeconds: null },
    ]);
  });

  it('ignores an invalid maximum on a guest with more remaining patience', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(10, 20), member(20, NaN)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'known', fraction: 0.5, exhaustionSeconds: 10 },
    ]);
  });

  it('reports unknown when one of the tied lowest-remaining guests has an invalid maximum', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(10, 20), member(10, NaN)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'unknown', fraction: null, exhaustionSeconds: null },
    ]);
  });

  it('clamps a remaining bonus above the maximum to one', () => {
    const state = { queue: [{ partyId: 'p1', members: [member(50, 20)] }] };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 1, status: 'known', fraction: 1, exhaustionSeconds: 50 },
    ]);
  });

  it('keeps a tiny positive fraction and estimate positive', () => {
    const [record] = getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(0.000001, 100)] }],
    });
    expect(record.status).toBe('known');
    expect(record.fraction).toBeGreaterThan(0);
    expect(record.fraction).toBeLessThan(0.001);
    expect(record.exhaustionSeconds).toBeGreaterThan(0);
    expect(record.exhaustionSeconds).toBeLessThan(0.001);
  });

  it('groups legacy bare queue members into their party', () => {
    const state = {
      queue: [
        { partyId: 'p1', id: 'a', queuePatience: 10, queuePatienceMax: 20 },
        { partyId: 'p1', id: 'b', queuePatience: 20, queuePatienceMax: 100 },
      ],
    };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'known', fraction: 0.5, exhaustionSeconds: 10 },
    ]);
  });

  it('excludes parties without members while they still add queue pressure', () => {
    const state = {
      queue: [
        { partyId: 'empty', members: [] },
        { partyId: 'p1', members: [member(10, 20)] },
      ],
    };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 1, status: 'known', fraction: 0.5, exhaustionSeconds: 10 / 1.1 },
    ]);
  });

  it('counts actual members rather than a declared partySize', () => {
    const state = {
      queue: [{
        partyId: 'p1',
        members: [member(10, 20, { partySize: 99 }), member(20, 100), member(30, 100)],
      }],
    };
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 3, status: 'known', fraction: 0.5, exhaustionSeconds: 10 },
    ]);
  });

  it('retains logical queue order even when patience order differs', () => {
    const state = {
      queue: [
        { partyId: 'first', members: [member(50, 100)] },
        { partyId: 'second', members: [member(5, 100)] },
      ],
    };
    expect(getQueuePatienceSummary(state).map(record => record.partyId)).toEqual(['first', 'second']);
    expect(getQueuePatienceSummary(state).map(record => record.fraction)).toEqual([0.5, 0.05]);
    expect(getQueuePatienceSummary(state).map(record => record.exhaustionSeconds))
      .toEqual([50 / 1.1, 5 / 1.1]);
  });

  it('is unaffected by absent, partial or complete valid queue leases', () => {
    const queue = [
      { partyId: 'p1', members: [member(10, 20), member(20, 100)] },
      { partyId: 'p2', members: [member(50, 100, { partySize: 4 })] },
    ];
    const expected = getQueuePatienceSummary({ queue });
    expect(getQueuePatienceSummary({ queue, queueSlots: [] })).toEqual(expected);
    expect(getQueuePatienceSummary({
      queue,
      queueSlots: [{
        memberId: queue[0].members[0].id,
        partyId: 'p1',
        x: 10,
        y: 20,
        slot: 0,
      }],
    })).toEqual(expected);
    expect(getQueuePatienceSummary({
      queue,
      queueSlots: queue.flatMap(party => party.members.map((memberRecord, index) => ({
        memberId: memberRecord.id,
        partyId: party.partyId,
        x: 10,
        y: 20 + index * 20,
        slot: index,
      }))),
    })).toEqual(expected);
  });

  it('does not mutate a recursively frozen input', () => {
    const state = freeze({
      queue: [{ partyId: 'p1', members: [member(10, 20), member(0, 100)] }],
      queueSlots: [],
    });
    const snapshot = JSON.stringify(state);
    expect(getQueuePatienceSummary(state)).toEqual([
      { partyId: 'p1', guestCount: 2, status: 'exhausted', fraction: 0, exhaustionSeconds: 0 },
    ]);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('never calls Math.random', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random must not be called');
    });
    expect(getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(10, 20)] }],
    })).toEqual([
      { partyId: 'p1', guestCount: 1, status: 'known', fraction: 0.5, exhaustionSeconds: 10 },
    ]);
    expect(randomSpy).not.toHaveBeenCalled();
  });

  it('estimates one party at its lowest current remaining patience', () => {
    const [record] = getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(120, 120)] }],
    });
    expect(record.exhaustionSeconds).toBe(120);
  });

  it('divides the estimate by the pressure from every normalised party', () => {
    const records = getQueuePatienceSummary({
      queue: [
        { partyId: 'p1', members: [member(132, 132)] },
        { partyId: 'p2', members: [member(100, 100)] },
      ],
    });
    expect(records[0].exhaustionSeconds).toBeCloseTo(120);
    expect(records[1].exhaustionSeconds).toBe(100 / 1.1);
  });

  it('caps pressure at 1.5 for six or more parties', () => {
    const queue = Array.from({ length: 6 }, (_, index) => ({
      partyId: `p${index + 1}`,
      members: [member(index === 0 ? 180 : 100, 100)],
    }));
    const records = getQueuePatienceSummary({ queue });
    expect(records[0].exhaustionSeconds).toBe(120);
    expect(records[1].exhaustionSeconds).toBe(100 / 1.5);
  });

  it('counts party count, not raw entry count, for legacy entries', () => {
    const [record] = getQueuePatienceSummary({
      queue: [
        { partyId: 'p1', id: 'a', queuePatience: 10, queuePatienceMax: 20 },
        { partyId: 'p2', id: 'b', queuePatience: 10, queuePatienceMax: 20 },
      ],
    });
    expect(record.exhaustionSeconds).toBe(10 / 1.1);
  });

  it('reports no estimate while closed, even for exhausted parties', () => {
    const records = getQueuePatienceSummary({
      queue: [
        { partyId: 'known', members: [member(100, 100)] },
        { partyId: 'exhausted', members: [member(0, 100)] },
      ],
      restaurant: { gameTime: 20 * 3600, openHour: 9, closeHour: 17 },
    });
    expect(records.map(record => record.status)).toEqual(['known', 'exhausted']);
    expect(records.map(record => record.fraction)).toEqual([1, 0]);
    expect(records.map(record => record.exhaustionSeconds)).toEqual([null, null]);
  });

  it('estimates through an overnight open window', () => {
    const [record] = getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(100, 100)] }],
      restaurant: { gameTime: 23 * 3600, openHour: 18, closeHour: 2 },
    });
    expect(record.exhaustionSeconds).toBe(100);
  });

  it('estimates for an all-day window where opening and closing hours match', () => {
    const [record] = getQueuePatienceSummary({
      queue: [{ partyId: 'p1', members: [member(100, 100)] }],
      restaurant: { gameTime: 3 * 3600, openHour: 0, closeHour: 0 },
    });
    expect(record.exhaustionSeconds).toBe(100);
  });

  it('does not change the game-time estimate for pause, speed or walk-ins-paused flags', () => {
    const queue = [{ partyId: 'p1', members: [member(90, 100)] }];
    const [baseline] = getQueuePatienceSummary({ queue });
    const [record] = getQueuePatienceSummary({
      queue,
      paused: true,
      speed: 3,
      restaurant: { walkInsPaused: true },
    });
    expect(record.exhaustionSeconds).toBe(90);
    expect(record.exhaustionSeconds).toBe(baseline.exhaustionSeconds);
  });

  it('does not reapply service-contract arrival decay to the prospective estimate', () => {
    const plain = { partyId: 'p1', members: [member(90, 100), member(90, 100)] };
    const withContract = {
      partyId: 'p1',
      members: [
        member(90, 100, { serviceContractId: 'sc1', serviceContractArrivalAt: 0 }),
        member(90, 100, { serviceContractId: 'sc1', serviceContractArrivalAt: 10000 }),
      ],
    };
    const restaurant = { gameTime: 10000 };
    const [contractRecord] = getQueuePatienceSummary({ restaurant, queue: [withContract] });
    const [plainRecord] = getQueuePatienceSummary({ restaurant, queue: [plain] });
    expect(contractRecord.exhaustionSeconds).toBe(90);
    expect(contractRecord.exhaustionSeconds).toBe(plainRecord.exhaustionSeconds);
  });
});
