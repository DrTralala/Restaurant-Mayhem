import { describe, expect, it } from 'vitest';
import {
  QUEUE_PARTY_CAPACITY,
  getQueueBandSlots,
  getQueueDisplayLayout,
  getQueueFreeBandSlots,
  getQueuePartyCount,
  getQueueProjectedMembers,
  getQueueVisibleMembers,
  findOldestCompatibleQueueParty,
  normaliseCustomerQueue,
  normaliseQueueSlots,
  reconcileQueueSlots,
} from './customerQueue';
import { buildCustomerQueueStressState } from './customerQueueStress';
import { getRestaurantWorld } from './world';

const CHARACTER_FOOTPRINT = Object.freeze({ left: 9, right: 9, top: 4, bottom: 22 });

function stressQueueState(override = {}) {
  const fixture = buildCustomerQueueStressState();
  return {
    restaurant: { expansionLevel: 1, gameTime: 12 * 3600 },
    queue: fixture.queue,
    customers: [],
    staff: [],
    ...override,
  };
}

function partyQueueState({ members, restaurant = { expansionLevel: 1 } } = {}) {
  const queue = normaliseCustomerQueue(members);
  return { restaurant, queue, customers: [], staff: [] };
}

function lease(memberId, partyId, x, y, slot = undefined) {
  return { memberId, partyId, x, y, ...(slot === undefined ? {} : { slot }) };
}

describe('customer queue party records', () => {
  it('groups legacy members by first-seen party order and is idempotent', () => {
    const legacy = [
      { id: 'a1', partyId: 'a' },
      { id: 'b1', partyId: 'b' },
      { id: 'a2', partyId: 'a' },
    ];
    const once = normaliseCustomerQueue(legacy);
    expect(once.map(party => party.partyId)).toEqual(['a', 'b']);
    expect(once[0].members.map(member => member.id)).toEqual(['a1', 'a2']);
    expect(normaliseCustomerQueue(once)).toEqual(once);
  });

  it('counts party records rather than members', () => {
    const queue = normaliseCustomerQueue([
      { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
      { id: 'b1', partyId: 'b' },
    ]);
    expect(getQueuePartyCount(queue)).toBe(2);
    expect(QUEUE_PARTY_CAPACITY).toBe(8);
  });

  it('selects the oldest compatible party without removing earlier records', () => {
    const queue = normaliseCustomerQueue([
      { id: 'large-1', partyId: 'large' }, { id: 'large-2', partyId: 'large' },
      { id: 'solo-1', partyId: 'solo' },
    ]);
    expect(findOldestCompatibleQueueParty(queue, party => party.members.length <= 1)?.partyId)
      .toBe('solo');
    expect(queue.map(party => party.partyId)).toEqual(['large', 'solo']);
  });

  it('projects leased members at exact stored points and unplaced members at the shared overflow point', () => {
    const state = partyQueueState({
      members: [
        { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
        { id: 'b1', partyId: 'b' },
      ],
    });
    const world = getRestaurantWorld(state.restaurant);
    const queue = state.queue;
    const seeded = {
      ...state,
      queueSlots: [
        lease('a1', 'a', 973, 390, 0),
        lease('b1', 'b', 1000, 999, 7),
      ],
    };
    const projected = getQueueProjectedMembers(seeded, queue);
    expect(projected.map(member => ({ id: member.id, x: member.x, y: member.y }))).toEqual([
      { id: 'a1', x: 973, y: 390 },
      { id: 'a2', x: 973, y: 648 },
      { id: 'b1', x: 1000, y: 999 },
    ]);
    const visible = getQueueVisibleMembers(seeded, queue);
    expect(visible.map(member => ({ id: member.id, x: member.x, y: member.y }))).toEqual([
      { id: 'a1', x: 973, y: 390 },
      { id: 'b1', x: 1000, y: 999 },
    ]);
    // Overflow copies never become physical blockers.
    expect(visible.every(member => member.y === 390 || member.y === 999)).toBe(true);
    expect(projected.every(member => Number.isFinite(member.x) && Number.isFinite(member.y))).toBe(true);
    expect(projected.every(member => member.x - CHARACTER_FOOTPRINT.left >= world.queueX
      && member.x + CHARACTER_FOOTPRINT.right <= world.queueX + world.queueW
      || member.x === 1000)).toBe(true);
    expect(queue.every(party => party.members.every(member =>
      !('x' in member) && !('y' in member) && !('path' in member) && !('pathGoal' in member)))).toBe(true);
  });

  it('counts the display layout from leases and never slices an existing lease', () => {
    const state = partyQueueState({
      members: Array.from({ length: 4 }, (_, index) => ({ id: `m${index}`, partyId: 'p' })),
    });
    const layout = getQueueDisplayLayout({
      ...state,
      queueSlots: [lease('m1', 'p', 973, 390, 0), lease('m3', 'p', 973, 450, 2)],
    }, state.queue);
    expect(layout.visibleMembers.map(member => member.id)).toEqual(['m1', 'm3']);
    expect(layout.hiddenCount).toBe(2);
    expect(layout.overflowLabelPosition).toEqual({ x: 973, y: 660 });
  });

  it('exposes current band candidates in index order with slot metadata', () => {
    const state = { restaurant: { expansionLevel: 1 } };
    const slots = getQueueBandSlots(state);
    expect(slots).toHaveLength(9);
    expect(slots[0]).toEqual({ slot: 0, x: 973, y: 390 });
    expect(slots[8]).toEqual({ slot: 8, x: 973, y: 630 });
    expect(getQueueBandSlots({ restaurant: { expansionLevel: 2 } })).toHaveLength(11);
  });

  it('reports free candidates under the strict 16 px predicate including lease origins and actors', () => {
    const state = stressQueueState();
    const leases = [
      lease('stress-party-01-customer-1', 'stress-party-01', 973, 390, 0),
      lease('stress-party-01-customer-2', 'stress-party-01', 973, 420, 1),
    ];
    state.staff = [{ id: 'guide', x: 973, y: 450 }];
    const free = getQueueFreeBandSlots(state, leases);
    expect(free.every(slot => {
      const all = [...leases, ...state.staff];
      return all.every(actor => Math.hypot(slot.x - actor.x, slot.y - actor.y) >= 16);
    })).toBe(true);
    expect(free.map(slot => slot.slot)).toEqual([3, 4, 5, 6, 7, 8]);
  });
});

describe('queue slot lease normalisation and reconciliation', () => {
  it('accepts only matching records with finite exact coordinates and safe optional slot metadata', () => {
    const state = partyQueueState({
      members: [
        { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
        { id: 'b1', partyId: 'b' },
      ],
    });
    const normalised = normaliseQueueSlots([
      lease('a1', 'a', 973, 390, 0),
      lease('a2', 'a', 973, 420),               // slot omitted
      lease('a2', 'a', 973, 420, 3),            // duplicate member -> conflicts with above
      lease('b1', 'b', 973, 450, 2),
      { memberId: 'ghost', partyId: 'a', x: 973, y: 480 },   // unknown member
      { memberId: 'a1', partyId: 'b', x: 973, y: 390 },      // party mismatch
      { memberId: 'a1', partyId: 'a', x: Number.NaN, y: 390 },
      { memberId: 'a1', partyId: 'a', x: 973, y: Infinity },
      { memberId: 'a1', partyId: 'a', x: 973, y: 390, slot: -1 },
      { memberId: 'a1', partyId: 'a', x: 973, y: 390, slot: 1.5 },
      null,
      'not-an-object',
    ], state);
    expect(normalised).toEqual([
      lease('a1', 'a', 973, 390, 0),
      lease('b1', 'b', 973, 450, 2),
    ]);
  });

  it('rejects every record in a conflicting component when leases overlap or duplicate', () => {
    const state = partyQueueState({
      members: [
        { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
        { id: 'b1', partyId: 'b' }, { id: 'b2', partyId: 'b' },
      ],
    });
    const normalised = normaliseQueueSlots([
      lease('a1', 'a', 973, 390, 0),
      lease('a2', 'a', 973, 400, 1),     // 10 px from a1 -> conflict component
      lease('b1', 'b', 973, 450, 2),
      lease('b2', 'b', 973, 450, 3),     // duplicate point with b1
    ], state);
    expect(normalised).toEqual([]);
  });

  it('rejects a standing lease within 16 px of an unrelated actor but keeps the same owner leaver', () => {
    const standing = partyQueueState({
      members: [{ id: 'm1', partyId: 'p' }],
    });
    standing.staff = [{ id: 'walker', x: 973, y: 400 }];
    expect(normaliseQueueSlots([lease('m1', 'p', 973, 390, 0)], standing)).toEqual([]);

    const departure = {
      ...partyQueueState({ members: [] }),
      customers: [{ id: 'm1', partyId: 'p', state: 'leaving', x: 973, y: 390 }],
    };
    // The matching leaving customer at its own retained origin is the same
    // owner, not an unrelated conflict.
    expect(normaliseQueueSlots([lease('m1', 'p', 973, 390, 0)], departure)).toEqual([
      lease('m1', 'p', 973, 390, 0),
    ]);
  });

  it('reconciles idempotently and appends FIFO grants at any free physical slot', () => {
    const state = partyQueueState({
      members: [
        { id: 'a1', partyId: 'a' }, { id: 'a2', partyId: 'a' },
        { id: 'b1', partyId: 'b' },
      ],
    });
    const once = reconcileQueueSlots(state, []);
    expect(once).toEqual([
      lease('a1', 'a', 973, 390, 0),
      lease('a2', 'a', 973, 420, 1),
      lease('b1', 'b', 973, 450, 2),
    ]);
    expect(reconcileQueueSlots(state, once)).toEqual(once);
  });

  it('releases cleared or orphaned departure leases and retains uncleared ones', () => {
    const near = {
      ...partyQueueState({ members: [{ id: 'q1', partyId: 'p' }] }),
      customers: [
        { id: 'gone', partyId: 'p', state: 'leaving', x: 973, y: 410 },
      ],
    };
    const reconciled = reconcileQueueSlots(near, [lease('gone', 'p', 973, 390, 0)]);
    // The leaver moved 20 px clear, so its origin lease is released and the
    // standing member may legally claim it.
    expect(reconciled).toEqual([lease('q1', 'p', 973, 390, 0)]);

    const uncleared = {
      ...partyQueueState({ members: [{ id: 'q1', partyId: 'p' }] }),
      customers: [
        { id: 'gone', partyId: 'p', state: 'leaving', x: 973, y: 400 },
      ],
    };
    const retained = reconcileQueueSlots(uncleared, [lease('gone', 'p', 973, 390, 0)]);
    expect(retained).toEqual([
      lease('gone', 'p', 973, 390, 0),
      lease('q1', 'p', 973, 420, 1),
    ]);

    const orphaned = partyQueueState({ members: [] });
    expect(reconcileQueueSlots(orphaned, [lease('gone', 'p', 973, 390, 0)])).toEqual([]);
  });
});

describe('queue slot layout expansion', () => {
  it('never relocates, clips or re-sorts an existing lease when the band moves', () => {
    const state = partyQueueState({
      members: [
        { id: 'a1', partyId: 'a' },
        { id: 'a2', partyId: 'a' },
      ],
    });
    const levelOne = { ...state, queueSlots: [lease('a1', 'a', 973, 390, 0)] };
    const expanded = { ...levelOne, restaurant: { expansionLevel: 2 } };

    // The stored lease keeps its exact level-1 position through the projection,
    // reconciliation and display layout.
    expect(getQueueVisibleMembers(expanded, expanded.queue).map(member => ({ x: member.x, y: member.y })))
      .toEqual([{ x: 973, y: 390 }]);
    expect(reconcileQueueSlots(expanded, levelOne.queueSlots)[0])
      .toEqual(lease('a1', 'a', 973, 390, 0));
    expect(getQueueDisplayLayout(expanded, expanded.queue).visibleMembers[0])
      .toMatchObject({ id: 'a1', x: 973, y: 390 });

    // A new member may use a safe level-2 candidate; the old lease is untouched.
    const regranted = reconcileQueueSlots(expanded, levelOne.queueSlots);
    expect(regranted).toEqual([
      lease('a1', 'a', 973, 390, 0),
      lease('a2', 'a', 1153, 450, 0),
    ]);
  });
});

describe('any-free FIFO liveness for the real 8x4/B=9 fixture', () => {
  it('grants hidden FIFO members into early cleared holes even when a rearmost lease is held', () => {
    const state = stressQueueState();
    const members = state.queue.flatMap(party => party.members);
    // Seed members 5..9 standing at the rearmost candidates (slots 4..8, y
    // 510..630) so the front holes 0..3 are free while the last candidate is
    // still owned by a valid member.
    const rearmostLeases = members.slice(4, 9).map((member, index) =>
      lease(member.id, member.partyId, 973, 510 + index * 30, index + 4));
    const reconciled = reconcileQueueSlots(state, rearmostLeases);
    expect(reconciled).toHaveLength(9);
    // The earlier seeded leases are retained byte-for-byte in their given order.
    expect(reconciled.slice(0, 5)).toEqual(rearmostLeases);
    // FIFO hidden members claim the free early holes rather than being stranded
    // by max(slot) === 8.
    expect(reconciled.find(record => record.x === 973 && record.y === 390).memberId)
      .toBe(members[0].id);
    expect(reconciled.find(record => record.x === 973 && record.y === 420).memberId)
      .toBe(members[1].id);
    expect(reconciled.map(record => record.memberId).sort())
      .toEqual(members.slice(0, 9).map(member => member.id).sort());
  });
});

describe('seed validation and canonical projection combined boundaries', () => {
  function singleMemberState(records) {
    return {
      ...partyQueueState({
        members: [{ id: 'q', partyId: 'p' }],
      }),
      queueSlots: records,
    };
  }

  it('rejects every duplicate claim even when one sibling also conflicts with an actor', () => {
    const state = singleMemberState([
      lease('q', 'p', 973, 390, 0),
      lease('q', 'p', 973, 450, 2),
    ]);
    state.staff = [{ id: 'walker', x: 973, y: 400 }];
    // The actor filter must not erase the duplicate conflict: both structurally
    // valid claims are rejected, never an input-order winner.
    expect(normaliseQueueSlots(state.queueSlots, state)).toEqual([]);
  });

  it('never projects a last-wins duplicate coordinate for an ambiguous member', () => {
    const forward = singleMemberState([
      lease('q', 'p', 973, 390, 0),
      lease('q', 'p', 973, 450, 2),
    ]);
    const reversed = singleMemberState([
      lease('q', 'p', 973, 450, 2),
      lease('q', 'p', 973, 390, 0),
    ]);
    expect(normaliseQueueSlots(forward.queueSlots, forward)).toEqual([]);
    expect(getQueueVisibleMembers(forward, forward.queue)).toEqual([]);
    expect(getQueueVisibleMembers(reversed, reversed.queue)).toEqual([]);
    const projected = getQueueProjectedMembers(forward, forward.queue);
    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({ id: 'q', x: 973, y: 648 });
  });

  it('never recovers a foreign-party record as a standing coordinate', () => {
    const state = singleMemberState([lease('q', 'other-party', 973, 390, 0)]);
    expect(normaliseQueueSlots(state.queueSlots, state)).toEqual([]);
    expect(getQueueVisibleMembers(state, state.queue)).toEqual([]);
    expect(getQueueProjectedMembers(state, state.queue)[0]).toMatchObject({ id: 'q', x: 973, y: 648 });
  });
});

describe('runtime reconciliation preserves trusted leases in an already-unsafe state', () => {
  it('retains the exact lease and blocks new grants when an unrelated actor is close', () => {
    const state = {
      ...partyQueueState({
        members: [{ id: 'q', partyId: 'p' }],
      }),
      queueSlots: [lease('q', 'p', 973, 390, 0)],
      staff: [{ id: 'cook', role: 'cook', x: 973, y: 400 }],
    };
    // Direct reconcile must not relocate q to a "recovered" candidate.
    expect(reconcileQueueSlots(state, state.queueSlots)).toEqual([lease('q', 'p', 973, 390, 0)]);
    // No other unleased member may be granted while the runtime state is unsafe.
    const withSecondMember = {
      ...state,
      queue: normaliseCustomerQueue([
        { id: 'q', partyId: 'p' }, { id: 'r', partyId: 'p' },
      ]),
    };
    expect(reconcileQueueSlots(withSecondMember, state.queueSlots))
      .toEqual([lease('q', 'p', 973, 390, 0)]);
  });
});
