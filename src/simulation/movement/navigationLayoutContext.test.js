import { describe, expect, it, vi } from 'vitest';
import * as navigation from './navigationWorkspace';
import { captureNavigation } from '../navigation/telemetry';
import { createInitialState } from '../../state/initialState';
import { runTick } from '../gameLoop';

const fixture = () => ({
  restaurant: { expansionLevel: 1 },
  tables: [{ id: 'context-table', x: 200, y: 200 }],
  chairs: [{ id: 'context-chair', tableId: 'context-table', x: 240, y: 200, rotation: 0 }],
  kitchenStations: [], serviceTables: [], cashierStations: [], washStations: [],
  staffAmenities: [{ id: 'context-amenity', type: 'couch', x: 400, y: 300, rotation: 0 }],
  doors: [{ id: 'context-door', y: 340, role: 'entrance' }],
});
const within = (state, run) => {
  expect(navigation.withNavigationLayoutContext).toBeTypeOf('function');
  return navigation.withNavigationLayoutContext(state, run);
};
const simulate = (state, run) => {
  expect(navigation.withSimulationNavigationLayoutContext).toBeTypeOf('function');
  return navigation.withSimulationNavigationLayoutContext(state, run);
};
const geometry = workspace => ({ bounds: workspace.bounds, keys: workspace.blockedCellKeys,
  fingerprint: workspace.topologyFingerprint });

function guardWork(run) {
  const descriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor');
  const prototype = vi.spyOn(Object, 'getPrototypeOf');
  try {
    descriptor.mockClear();
    prototype.mockClear();
    const value = run();
    const jsonSafetyDescriptors = descriptor.mock.calls.filter(([record, key]) => key === 'toJSON'
      && (record === Object.prototype || record === Array.prototype)).length;
    return { value, descriptors: descriptor.mock.calls.length, prototypes: prototype.mock.calls.length,
      iteratorDescriptors: descriptor.mock.calls.filter(([_record, key]) => key === Symbol.iterator).length,
      jsonSafetyDescriptors };
  } finally { descriptor.mockRestore(); prototype.mockRestore(); }
}

describe('simulation-owned synchronous navigation layout context', () => {
  it('does not allocate generic per-record Maps for single-kind memo entries', () => {
    const originalSet = Map.prototype.set;
    const recordWrites = [];
    const set = vi.spyOn(Map.prototype, 'set').mockImplementation(function (key, value) {
      if (typeof key === 'string' && key.startsWith('record:') && !Array.isArray(value)) recordWrites.push(key);
      return originalSet.call(this, key, value);
    });
    try {
      const state = fixture();
      within(state, () => navigation.createNavigationWorkspace(state));
    } finally { set.mockRestore(); }
    expect(recordWrites).toEqual([]);
  });

  it('preserves separate kinds for shared records and remembers unsupported null entries', () => {
    const shared = { id: 'multi-kind-record', x: 200, y: 200, tableId: 'multi-kind-record', rotation: 0 };
    const state = { ...fixture(), tables: [shared], chairs: [shared] };
    const expected = geometry(navigation.createNavigationWorkspace(state));
    const captured = captureNavigation(() => within(state, () => {
      expect(geometry(navigation.createNavigationWorkspace(state))).toEqual(expected);
      expect(geometry(navigation.createNavigationWorkspace({ ...state, tables: [shared], chairs: [shared] }))).toEqual(expected);
    }));
    expect(captured.report.counters.workspaceLayoutInputSpills).toBeGreaterThan(0);

    const unsupported = { id: 'null-memo-record', get x() { return 200; }, y: 200 };
    const minimal = { restaurant: { expansionLevel: 1 }, tables: [unsupported] };
    const failed = captureNavigation(() => within(minimal, () => {
      navigation.createNavigationWorkspace(minimal);
      navigation.createNavigationWorkspace({ ...minimal, tables: [unsupported] });
    }));
    expect(failed.report.counters.workspaceLayoutRecordChecks).toBe(1);
  });

  it.each(['same-kind', 'different-kind'])('does not publish an unfinished memo during %s re-entry', kind => {
    const record = { id: 'reentrant-record', x: 200, y: 200, tableId: 'reentrant-record', rotation: 0 };
    const plain = { ...fixture(), tables: [record], chairs: [], staffAmenities: [] };
    const plainNested = kind === 'same-kind' ? { ...plain, tables: [record] }
      : { ...plain, tables: [], chairs: [record] };
    const expected = geometry(navigation.createNavigationWorkspace(plain));
    const expectedNested = geometry(navigation.createNavigationWorkspace(plainNested));
    let entered = false;
    let nested;
    let nestedWorkspace;
    const proxy = new Proxy(record, { get(target, key) {
      if (key === 'x' && !entered) {
        entered = true;
        nestedWorkspace = navigation.createNavigationWorkspace(nested);
      }
      return target[key];
    } });
    const state = { ...plain, tables: [proxy] };
    nested = kind === 'same-kind' ? { ...state, tables: [proxy] }
      : { ...state, tables: [], chairs: [proxy] };
    const captured = captureNavigation(() => within(state, () => {
      expect(geometry(navigation.createNavigationWorkspace(state))).toEqual(expected);
      expect(geometry(nestedWorkspace)).toEqual(expectedNested);
      expect(geometry(navigation.createNavigationWorkspace(nested))).toEqual(expectedNested);
    }));
    expect(entered).toBe(true);
    expect(captured.report.counters.workspaceLayoutContextHits).toBeGreaterThan(0);
  });

  it('captures only kind and field values in context record payloads for every fixture schema', () => {
    const state = {
      ...fixture(),
      tables: [{ id: 'compact-table', x: 200, y: 200 }],
      chairs: [{ id: 'compact-chair', tableId: 'compact-table', x: 240, y: 200, rotation: 0 }],
      kitchenStations: [{ id: 'compact-kitchen', x: 100, y: 100 }],
      serviceTables: [{ id: 'compact-service', x: 300, y: 200, rotation: 0 }],
      cashierStations: [{ id: 'compact-cashier', x: 500, y: 200 }],
      washStations: [{ id: 'compact-wash', x: 600, y: 200, w: 40, h: 40 }],
      staffAmenities: [{ id: 'compact-amenity', type: 'couch', x: 400, y: 300, rotation: 0 }],
      doors: [{ id: 'compact-door', y: 340, role: 'entrance' }],
    };
    const expectedGeometry = geometry(navigation.createNavigationWorkspace(state));
    const freeze = Object.freeze;
    const payloads = [];
    const spy = vi.spyOn(Object, 'freeze').mockImplementation(value => {
      if (Array.isArray(value) && typeof value[0] === 'string' && value[0].startsWith('record:')) {
        payloads.push([...value]);
      }
      return freeze(value);
    });
    let actual;
    try { actual = within(state, () => navigation.createNavigationWorkspace(state)); }
    finally { spy.mockRestore(); }

    expect(geometry(actual)).toEqual(expectedGeometry);
    expect(payloads.map(values => [values[0], values.length])).toEqual([
      ['record:tables', 4], ['record:chairs', 6], ['record:kitchenStations', 4],
      ['record:serviceTables', 5], ['record:cashierStations', 4], ['record:washStations', 6],
      ['record:staffAmenities', 7], ['record:doors', 4],
    ]);
    expect(payloads.reduce((total, values) => total + values.length, 0)).toBe(40);
    expect(payloads[0]).toEqual(['record:tables', 'compact-table', 200, 200]);
    expect(payloads[1]).toEqual(['record:chairs', 'compact-chair', 240, 200, 'compact-table', 0]);
    // The amenity's configuration token remains an independently validated,
    // immutable child rather than being dropped with redundant schema labels.
    expect(Object.isFrozen(payloads[6][6])).toBe(true);
  });

  it('retains descriptor validation and value-read order when capturing compact records', () => {
    const state = fixture();
    const reads = [];
    state.tables = [new Proxy({ id: 'compact-read-order', x: 200, y: 200 }, {
      getOwnPropertyDescriptor(record, key) {
        reads.push(`descriptor:${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(record, key);
      },
      get(record, key) {
        reads.push(`value:${String(key)}`);
        return record[key];
      },
    })];
    within(state, () => navigation.createNavigationWorkspace(state));
    expect(reads.slice(0, 6)).toEqual([
      'descriptor:id', 'value:id', 'descriptor:x', 'value:x', 'descriptor:y', 'value:y',
    ]);
  });

  it('builds one signature and raster across scopes with completely replaced source identities', () => {
    const captured = captureNavigation(() => {
      let fingerprint;
      for (let scope = 0; scope < 12; scope += 1) {
        const state = fixture();
        state.tables[0].id = 'cross-scope-content-cache';
        state.tables[0].status = `status-${scope}`;
        within(state, () => {
          const first = navigation.createNavigationWorkspace(state);
          const second = navigation.createNavigationWorkspace(state);
          expect(first.state).toBe(state);
          expect(second).not.toBe(first);
          fingerprint ??= first.topologyFingerprint;
          expect(first.topologyFingerprint).toBe(fingerprint);
        });
      }
    });
    expect(captured.report.counters.workspaceSignatureBuilds).toBe(1);
    expect(captured.report.counters.workspaceGeometryBuilds).toBe(1);
    expect(captured.report.counters.workspaceLayoutContentHits).toBe(11);
    expect(captured.report.counters.workspaceLayoutContextHits).toBe(12);
  });

  it('does not stringify already validated matching content in a new scope', () => {
    const firstState = fixture();
    firstState.tables[0].id = 'cross-scope-no-json';
    within(firstState, () => navigation.createNavigationWorkspace(firstState));
    const nextState = structuredClone(firstState);
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      within(nextState, () => navigation.createNavigationWorkspace(nextState));
      expect(stringify).not.toHaveBeenCalled();
    } finally { stringify.mockRestore(); }
  });

  it('retains copied content rather than references to the previous scope sources', () => {
    const state = fixture();
    state.tables[0].id = 'detached-context-content';
    const copy = structuredClone(state);
    const original = within(state, () => navigation.createNavigationWorkspace(state));
    state.tables[0].x += 80;
    state.chairs.length = 0;
    const captured = captureNavigation(() => within(copy, () => navigation.createNavigationWorkspace(copy)));
    expect(captured.value.topologyFingerprint).toBe(original.topologyFingerprint);
    expect(captured.value.state).toBe(copy);
    expect(captured.report.counters.workspaceLayoutContentHits).toBe(1);
    expect(within(state, () => navigation.createNavigationWorkspace(state)).topologyFingerprint)
      .not.toBe(original.topologyFingerprint);
  });

  it('rebuilds matching content if its geometry was evicted from the existing bounded cache', () => {
    const state = fixture();
    state.tables[0].id = 'evicted-context-content';
    const original = within(state, () => navigation.createNavigationWorkspace(state));
    for (let index = 0; index < 40; index += 1) {
      const other = fixture();
      other.tables[0].id = `context-eviction-${index}`;
      navigation.createNavigationWorkspace(other);
    }
    const captured = captureNavigation(() => within(state, () => navigation.createNavigationWorkspace(state)));
    expect(captured.value.topologyFingerprint).toBe(original.topologyFingerprint);
    expect(captured.report.counters.workspaceSignatureBuilds).toBe(1);
    expect(captured.report.counters.workspaceGeometryBuilds).toBe(1);
    expect(captured.report.counters.workspaceLayoutContentHits || 0).toBe(0);
  });

  it('validates each observed fixture once and reuses geometry across status-only copies', () => {
    const state = fixture();
    const copiedTable = { ...state.tables[0], status: 'reserved' };
    const derived = { ...state, tables: [copiedTable] };
    const repeatedArray = { ...state, tables: [...state.tables] };
    const descriptor = vi.spyOn(Object, 'getOwnPropertyDescriptor');
    let captured;
    try {
      captured = captureNavigation(() => within(state, owner => {
        const first = navigation.createNavigationWorkspace(owner);
        const second = navigation.createNavigationWorkspace(owner);
        const third = navigation.createNavigationWorkspace(derived);
        const fourth = navigation.createNavigationWorkspace(repeatedArray);
        return [first, second, third, fourth];
      }));
      for (const table of [state.tables[0], copiedTable]) {
        expect(descriptor.mock.calls.filter(([object, key]) => object === table && key === 'x')).toHaveLength(1);
      }
    } finally { descriptor.mockRestore(); }
    expect(captured.report.counters.workspaceLayoutContextHits).toBe(3);
    const [first, second, third, fourth] = captured.value;
    expect(first).not.toBe(second);
    expect(first.state).toBe(state);
    expect(second.state).toBe(state);
    expect(third.state).toBe(derived);
    expect(fourth.state).toBe(repeatedArray);
    for (const workspace of [second, third, fourth]) {
      expect(Object.isFrozen(workspace)).toBe(true);
      expect(workspace.blockedCells).toBe(first.blockedCells);
      expect(workspace.topologyFingerprint).toBe(first.topologyFingerprint);
    }
  });

  it('keeps exact public fingerprints for derived and synthetic layouts', () => {
    const state = fixture();
    const variants = [state,
      { ...state, chairs: [] },
      { ...state, staffAmenities: [] },
      { ...state, tables: [{ ...state.tables[0], x: 201 }] },
      { ...state, doors: [{ ...state.doors[0], y: 400 }] },
      { ...state, restaurant: { expansionLevel: 2 } },
      { ...state, tables: [{ ...state.tables[0], id: undefined }] },
      { ...state, tables: [{ ...state.tables[0], id: null }] },
    ];
    const expected = variants.map(value => geometry(navigation.createNavigationWorkspace(value)));
    const actual = within(state, () => variants.map(value => geometry(navigation.createNavigationWorkspace(value))));
    expect(actual).toEqual(expected);
    expect(actual[1].keys).not.toEqual(actual[0].keys);
    expect(actual[2].keys).not.toEqual(actual[0].keys);
    expect(actual[6].fingerprint).not.toBe(actual[7].fingerprint);
  });

  it('observes in-place edits between contexts and through standalone calls', () => {
    const state = fixture();
    const first = within(state, () => navigation.createNavigationWorkspace(state));
    state.tables[0].x += 20;
    const second = within(state, () => navigation.createNavigationWorkspace(state));
    expect(second.topologyFingerprint).not.toBe(first.topologyFingerprint);
    state.tables[0].x += 20;
    const third = navigation.createNavigationWorkspace(state);
    expect(third.topologyFingerprint).not.toBe(second.topologyFingerprint);
    state.tables[0].x += 20;
    expect(navigation.createNavigationWorkspace(state).topologyFingerprint).not.toBe(third.topologyFingerprint);
  });

  it('restores enclosing contexts and clears them on exception', () => {
    const outer = fixture();
    const inner = { ...fixture(), chairs: [] };
    const original = navigation.createNavigationWorkspace(outer);
    const captured = captureNavigation(() => expect(() => within(outer, () => {
      const first = navigation.createNavigationWorkspace(outer);
      expect(() => within(inner, () => {
        expect(navigation.createNavigationWorkspace(inner).topologyFingerprint).not.toBe(first.topologyFingerprint);
        throw new Error('nested failure');
      })).toThrow('nested failure');
      expect(navigation.createNavigationWorkspace(outer).blockedCells).toBe(first.blockedCells);
      throw new Error('outer failure');
    })).toThrow('outer failure'));
    expect(captured.report.counters.workspaceLayoutContextHits).toBe(1);
    outer.tables[0].x += 20;
    expect(navigation.createNavigationWorkspace(outer).topologyFingerprint).not.toBe(original.topologyFingerprint);
  });

  it('rejects async ownership and restores state after thenable returns', () => {
    const state = fixture();
    let invoked = false;
    expect(() => within(state, async () => { invoked = true; })).toThrow(/synchronous/i);
    expect(invoked).toBe(false);
    expect(() => within(state, () => {
      navigation.createNavigationWorkspace(state);
      return Promise.resolve();
    })).toThrow(/synchronous/i);
    const before = navigation.createNavigationWorkspace(state);
    state.tables[0].x += 20;
    expect(navigation.createNavigationWorkspace(state).topologyFingerprint).not.toBe(before.topologyFingerprint);
  });

  it('keeps accessors and uninspectable proxy sources on the general path', () => {
    const state = fixture();
    let x = 200;
    state.tables[0] = { id: 'accessor-context', get x() { return x; }, y: 200 };
    within(state, () => {
      const first = navigation.createNavigationWorkspace(state);
      x += 20;
      expect(navigation.createNavigationWorkspace(state).topologyFingerprint).not.toBe(first.topologyFingerprint);
    });
    const plain = fixture();
    const proxy = new Proxy(plain, { getOwnPropertyDescriptor() { throw new Error('uninspectable'); } });
    within(proxy, () => {
      const first = navigation.createNavigationWorkspace(proxy);
      plain.tables[0].x += 20;
      expect(navigation.createNavigationWorkspace(proxy).topologyFingerprint).not.toBe(first.topologyFingerprint);
    });
  });

  it('does not trust proxies whose property reads disagree with their data descriptors', () => {
    const state = fixture();
    state.tables = [new Proxy(state.tables[0], {
      get(record, key) { return key === 'x' ? record.x + 20 : record[key]; },
    })];
    const captured = captureNavigation(() => within(state, () => {
      navigation.createNavigationWorkspace(state);
      navigation.createNavigationWorkspace(state);
    }));
    expect(captured.report.counters.workspaceLayoutContextHits || 0).toBe(0);
  });

  it('builds lazily and preserves ordinary malformed-input errors', () => {
    const malformed = { ...fixture(), tables: {} };
    expect(within(malformed, () => 'no navigation')).toBe('no navigation');
    const error = callback => { try { callback(); return null; } catch (value) { return [value.name, value.message]; } };
    expect(error(() => within(malformed, () => navigation.createNavigationWorkspace(malformed))))
      .toEqual(error(() => navigation.createNavigationWorkspace(malformed)));
  });

  it('wraps real ticks without changing fixture geometry in place', () => {
    let state = createInitialState();
    const fields = ['id', 'x', 'y', 'rotation', 'w', 'h', 'tableId', 'type', 'role'];
    const collections = ['tables', 'chairs', 'kitchenStations', 'serviceTables', 'cashierStations',
      'washStations', 'staffAmenities', 'doors'];
    const snapshot = () => collections.map(name => (state[name] || []).map(record =>
      fields.map(key => record[key])));
    const expected = snapshot();
    for (const name of collections) for (const record of state[name] || []) {
      for (const key of fields) if (Object.hasOwn(record, key)) Object.defineProperty(record, key, { writable: false });
    }
    const captured = captureNavigation(() => {
      for (let tick = 0; tick < 60; tick += 1) {
        state = runTick(state, { gameDt: 8, movementDt: 4 / 30 });
        expect(state.navigationFault).toBeFalsy();
        expect(snapshot()).toEqual(expected);
      }
    });
    expect(captured.report.counters.workspaceLayoutContextHits).toBeGreaterThan(0);
  });
});

describe('demand-sensitive simulation layout ownership', () => {
  const resetDemand = state => simulate(state, () => undefined);
  const queries = (state, count) => captureNavigation(() => simulate(state, () =>
    Array.from({ length: count }, () => navigation.createNavigationWorkspace(state))));

  it('defers the first five requests, activates on six, and predicts sustained demand', () => {
    const state = fixture();
    resetDemand(state);
    const low = queries(state, 3);
    expect(low.report.counters.workspaceLayoutDeferredChecks).toBe(3);
    expect(low.report.counters.workspaceLayoutRecordChecks || 0).toBe(0);
    const burst = queries(state, 7);
    expect(burst.report.counters.workspaceLayoutDeferredChecks).toBe(5);
    expect(burst.report.counters.workspaceLayoutActivations).toBe(1);
    expect(burst.report.counters.workspaceLayoutContextHits).toBe(1);
    const predicted = queries(state, 2);
    expect(predicted.report.counters.workspaceLayoutDeferredChecks || 0).toBe(0);
    expect(predicted.report.counters.workspaceLayoutActivations).toBe(1);
    expect(predicted.report.counters.workspaceLayoutContextHits).toBe(1);
    const lowAgain = queries(state, 3);
    expect(lowAgain.report.counters.workspaceLayoutDeferredChecks).toBe(3);
    for (const workspace of [...low.value, ...burst.value, ...predicted.value, ...lowAgain.value]) {
      expect(workspace.state).toBe(state);
      expect(Object.isFrozen(workspace)).toBe(true);
    }
  });

  it('does not alter explicit eager scopes or let them train the simulation hint', () => {
    const state = fixture();
    resetDemand(state);
    const explicit = captureNavigation(() => within(state, () => {
      for (let index = 0; index < 12; index += 1) navigation.createNavigationWorkspace(state);
    }));
    expect(explicit.report.counters.workspaceLayoutDeferredChecks || 0).toBe(0);
    expect(explicit.report.counters.workspaceLayoutContextHits).toBe(11);
    expect(queries(state, 3).report.counters.workspaceLayoutDeferredChecks).toBe(3);
  });

  it('preserves synthetic layouts before and after activation and edits between ticks', () => {
    const state = fixture();
    const variants = [state, { ...state, chairs: [] }, { ...state, staffAmenities: [] }];
    const expected = variants.map(value => geometry(navigation.createNavigationWorkspace(value)));
    resetDemand(state);
    simulate(state, () => {
      for (let index = 0; index < 12; index += 1) {
        const source = variants[index % variants.length];
        const workspace = navigation.createNavigationWorkspace(source);
        expect(workspace.state).toBe(source);
        expect(geometry(workspace)).toEqual(expected[index % variants.length]);
      }
    });
    state.tables[0].x += 20;
    const edited = simulate(state, () => navigation.createNavigationWorkspace(state));
    expect(edited.topologyFingerprint).not.toBe(expected[0].fingerprint);
    expect(geometry(edited)).toEqual(geometry(navigation.createNavigationWorkspace(state)));
  });

  it('restores nested ownership and does not train the hint from nested or failed scopes', () => {
    const state = fixture();
    resetDemand(state);
    expect(() => simulate(state, () => {
      navigation.createNavigationWorkspace(state);
      within(state, () => {
        navigation.createNavigationWorkspace(state);
        navigation.createNavigationWorkspace(state);
      });
      queries(state, 8);
      const resumed = captureNavigation(() => navigation.createNavigationWorkspace(state));
      expect(resumed.report.counters.workspaceLayoutDeferredChecks).toBe(1);
      throw new Error('failed simulation');
    })).toThrow('failed simulation');
    expect(queries(state, 2).report.counters.workspaceLayoutDeferredChecks).toBe(2);
    const first = navigation.createNavigationWorkspace(state);
    state.tables[0].x += 20;
    expect(navigation.createNavigationWorkspace(state).topologyFingerprint).not.toBe(first.topologyFingerprint);
  });

  it('rejects asynchronous scopes and cleans up after an activated thenable return', () => {
    const state = fixture();
    resetDemand(state);
    let invoked = false;
    expect(() => simulate(state, async () => { invoked = true; })).toThrow(/synchronous/i);
    expect(invoked).toBe(false);
    expect(() => simulate(state, () => {
      for (let index = 0; index < 7; index += 1) navigation.createNavigationWorkspace(state);
      return Promise.resolve();
    })).toThrow(/synchronous/i);
    expect(queries(state, 2).report.counters.workspaceLayoutDeferredChecks).toBe(2);
  });
});

describe('plain-state simulation layout ownership', () => {
  // internal-plain-state-v1 excludes side-effectful internal getters/Proxies.
  // Existing accessor/Proxy tests above use public ownership and remain strict.
  it.each([
    ['deferred', 3, 6],
    ['activated', 8, 12],
  ])('eliminates defensive descriptor/prototype/iterator work for %s plain simulation requests', (label, count, expectedDescriptors) => {
    const state = createInitialState();
    state.tables[0].id = `plain-guard-reduction-${label}`;
    simulate(state, () => undefined);
    const warm = navigation.createNavigationWorkspace(state);
    const captured = captureNavigation(() => guardWork(() => simulate(state, () =>
      Array.from({ length: count }, () => navigation.createNavigationWorkspace(state)))));
    const work = captured.value;
    expect(work.descriptors).toBe(expectedDescriptors);
    expect(work.jsonSafetyDescriptors).toBe(expectedDescriptors);
    expect(work.prototypes).toBe(0);
    expect(work.iteratorDescriptors).toBe(0);
    expect(captured.report.counters.workspaceLayoutDeferredChecks).toBe(Math.min(count, 5));
    expect(captured.report.counters.workspaceFastlaneHits).toBe(Math.min(count, 5));
    if (count > 5) {
      expect(captured.report.counters.workspaceLayoutActivations).toBe(1);
      expect(captured.report.counters.workspaceLayoutContextHits).toBe(2);
    }
    for (const workspace of work.value) {
      expect(geometry(workspace)).toEqual(geometry(warm));
      expect(workspace.state).toBe(state);
      expect(workspace).not.toBe(warm);
      expect(navigation.isImmutableNavigationBlockedLookup(workspace.blockedCells)).toBe(true);
    }
  });

  it('keeps public inspection strict inside an internal scope and restores internal ownership after a nested error', () => {
    const owner = fixture();
    owner.tables[0].id = 'plain-nested-inspection-owner';
    simulate(owner, () => undefined);
    const expected = geometry(navigation.createNavigationWorkspace(owner));
    let x = 202;
    let reads = 0;
    const accessor = { ...fixture(), tables: [{ id: 'plain-nested-public-accessor', y: 222,
      get x() { reads += 1; return x; } }] };
    simulate(owner, () => {
      expect(() => within(accessor, () => {
        const first = navigation.createNavigationWorkspace(accessor);
        x += 20;
        const second = navigation.createNavigationWorkspace(accessor);
        expect(second.topologyFingerprint).not.toBe(first.topologyFingerprint);
        throw new Error('nested public failure');
      })).toThrow('nested public failure');
      const resumed = guardWork(() => navigation.createNavigationWorkspace(owner));
      expect(resumed.descriptors).toBe(resumed.jsonSafetyDescriptors);
      expect(resumed.prototypes).toBe(0);
      expect(geometry(resumed.value)).toEqual(expected);
    });
    expect(reads).toBe(2);
    const standalone = guardWork(() => navigation.createNavigationWorkspace(owner));
    expect(standalone.descriptors).toBeGreaterThan(standalone.jsonSafetyDescriptors);
    expect(standalone.prototypes).toBeGreaterThan(0);
  });

  it('restores a public accessor owner after an internal nested exception', () => {
    let x = 202;
    let reads = 0;
    const outer = { ...fixture(), tables: [{ id: 'plain-public-outer-accessor', y: 222,
      get x() { reads += 1; return x; } }] };
    const inner = fixture();
    within(outer, () => {
      const first = navigation.createNavigationWorkspace(outer);
      expect(() => simulate(inner, () => {
        navigation.createNavigationWorkspace(inner);
        throw new Error('nested internal failure');
      })).toThrow('nested internal failure');
      x += 20;
      const resumed = guardWork(() => navigation.createNavigationWorkspace(outer));
      expect(resumed.prototypes).toBeGreaterThan(0);
      expect(resumed.descriptors).toBeGreaterThan(resumed.jsonSafetyDescriptors);
      expect(resumed.value.topologyFingerprint).not.toBe(first.topologyFingerprint);
    });
    expect(reads).toBe(2);
  });

  it.each(['callback error', 'thenable result'])('clears internal-only assumptions after an activated %s', failure => {
    const state = fixture();
    state.tables[0].id = `plain-scope-cleanup-${failure}`;
    simulate(state, () => undefined);
    navigation.createNavigationWorkspace(state);
    let inside;
    expect(() => simulate(state, () => {
      inside = guardWork(() => Array.from({ length: 7 }, () => navigation.createNavigationWorkspace(state)));
      if (failure === 'callback error') throw new Error('owned callback failure');
      return { then() {} };
    })).toThrow(failure === 'callback error' ? 'owned callback failure' : /synchronous/i);
    expect(inside.descriptors).toBe(inside.jsonSafetyDescriptors);
    expect(inside.prototypes).toBe(0);
    const after = guardWork(() => navigation.createNavigationWorkspace(state));
    expect(after.descriptors).toBeGreaterThan(after.jsonSafetyDescriptors);
    expect(after.prototypes).toBeGreaterThan(0);
  });

  it.each(['geometry limit', 'entry limit'])('restores strict fallback inspection after the %s, including nested scopes', limit => {
    const state = fixture();
    state.tables[0].id = `plain-disabled-owner-${limit}`;
    simulate(state, () => undefined);
    simulate(state, () => {
      for (let index = 0; index < (limit === 'geometry limit' ? 39 : 2100); index += 1) {
        navigation.createNavigationWorkspace(limit === 'geometry limit'
          ? { ...state, tables: [{ ...state.tables[0], id: `plain-limit-${index}`, x: 202 + index }] }
          : { ...state });
      }
      const probe = { ...state, tables: [{ id: 'plain-disabled-probe', x: 202, y: 222 }] };
      const checkFallback = () => {
        const work = guardWork(() => navigation.createNavigationWorkspace(probe));
        expect(work.descriptors).toBeGreaterThan(work.jsonSafetyDescriptors);
        expect(work.prototypes).toBeGreaterThan(0);
        expect(work.value.blockedCells.has('10,11')).toBe(true);
        expect(work.value.state).toBe(probe);
      };
      checkFallback();
      simulate(state, () => navigation.createNavigationWorkspace(state));
      checkFallback();
    });
  });

  it.each([Object.prototype, Array.prototype])('keeps JSON prototype safety on the canonical fallback inside internal ownership', prototype => {
    const state = fixture();
    state.tables[0].id = 'plain-json-safety-owner';
    simulate(state, () => undefined);
    navigation.createNavigationWorkspace(state);
    const prior = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    try {
      Object.defineProperty(prototype, 'toJSON', { configurable: true, value() { return this; } });
      const captured = captureNavigation(() => simulate(state, () => {
        navigation.createNavigationWorkspace(state);
        navigation.createNavigationWorkspace(state);
      }));
      expect(captured.report.counters.workspaceSignatureBuilds).toBe(2);
      expect(captured.report.counters.workspaceFastlaneHits || 0).toBe(0);
    } finally {
      if (prior) Object.defineProperty(prototype, 'toJSON', prior);
      else delete prototype.toJSON;
    }
  });
});
