import { describe, expect, it } from 'vitest';
import { prioritiseQueuedParty } from './queuePriority';

function party(partyId, extra = {}) {
  return {
    partyId,
    members: [{ id: `${partyId}-member`, partyId, name: `${partyId} guest` }],
    metadata: { source: 'test' },
    ...extra,
  };
}

describe('prioritiseQueuedParty', () => {
  it.each([
    [1, ['b', 'a', 'c', 'd']],
    [3, ['d', 'a', 'b', 'c']],
  ])('moves selected index %i to the front and keeps exact party objects', (index, ids) => {
    const queue = Object.freeze(['a', 'b', 'c', 'd'].map(id => {
      const member = Object.freeze({ id: `${id}-guest`, partyId: id, nested: { value: id } });
      return Object.freeze({ partyId: id, members: Object.freeze([member]), marker: { id } });
    }));

    const next = prioritiseQueuedParty(queue, ids[0]);

    expect(next).not.toBe(queue);
    expect(next.map(record => record.partyId)).toEqual(ids);
    for (const original of queue) expect(next).toContain(original);
    expect(next[0]).toBe(queue[index]);
    expect(queue.map(record => record.partyId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it.each([
    ['null queue', null, 'b'],
    ['non-array queue', {}, 'b'],
    ['malformed party entry', [null], 'b'],
    ['missing party members', [{ partyId: 'b' }], 'b'],
    ['non-string party ID', [{ partyId: 7, members: [] }], '7'],
    ['blank party ID', [{ partyId: '  ', members: [] }], '  '],
    ['duplicate party IDs', [party('a'), party('a'), party('b')], 'b'],
    ['unknown party ID', [party('a'), party('b')], 'missing'],
    ['already-first party', [party('a'), party('b')], 'a'],
    ['numeric action ID', [party('7'), party('b')], 7],
    ['blank action ID', [party('a'), party('b')], '  '],
    ['missing action ID', [party('a'), party('b')], null],
  ])('returns the original input for %s', (_label, queue, partyId) => {
    expect(prioritiseQueuedParty(queue, partyId)).toBe(queue);
  });

  it('does not mutate or rebuild canonical party/member data', () => {
    const first = party('first', { extra: { keep: true } });
    const selected = party('selected', { custom: ['opaque', 3] });
    const last = party('last');
    const queue = [first, selected, last];

    const next = prioritiseQueuedParty(queue, 'selected');

    expect(next).toEqual([selected, first, last]);
    expect(next[0]).toBe(selected);
    expect(next[0].members).toBe(selected.members);
    expect(next[0].custom).toBe(selected.custom);
    expect(next[1]).toBe(first);
    expect(next[1].extra).toBe(first.extra);
    expect(queue).toEqual([first, selected, last]);
  });
});
