import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import StatsPanel from './StatsPanel';
import { DIRT_REPUTATION_THRESHOLD } from '../simulation/dirt';
import { getCanvasFont } from '../typography';
import { withOwnedAuthoredDishes } from '../simulation/menuTestFixtures';
import { createDishOrderSnapshot, getResolvedDish } from '../simulation/cookbook';

const { mockUseGameState, mockUseDispatch, requestNewSandboxMock } = vi.hoisted(() => ({
  mockUseGameState: vi.fn(),
  mockUseDispatch: vi.fn(),
  requestNewSandboxMock: vi.fn(),
}));
vi.mock('../state/GameContext', () => ({
  useGameState: () => mockUseGameState(),
  useDispatch: () => mockUseDispatch,
}));
vi.mock('../state/newSandbox', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    requestNewSandbox: (...args) => {
      requestNewSandboxMock(...args);
      return actual.requestNewSandbox(...args);
    },
  };
});

const baseState = {
  dailyHistory: [],
  restaurant: { totalServed: 0, day: 1, funds: 600, reputation: 3 },
  staff: [],
  dishes: [],
  partyReviewHistory: [],
  queue: [],
  customers: [],
  serviceItems: [],
};

const PENDING_FOOD_CAVEAT = 'Based on recorded customer timers, not a delivery ETA. '
  + 'Delivered or cancelled outcomes are excluded; service-item reconciliation occurs in the simulation.';

const REVENUE_CHART_CAPTION = 'Bars above zero show positive revenue; '
  + 'bars below zero show negative revenue. Unavailable values are omitted.';

function createRecordingContext() {
  const calls = { rects: [], texts: [], clears: [], transforms: [] };
  const ctx = {
    fillStyle: '#000',
    font: '',
    clearRect(x, y, width, height) {
      calls.clears.push({ x, y, width, height });
    },
    setTransform(...transform) {
      calls.transforms.push(transform);
    },
    fillRect(x, y, width, height) {
      calls.rects.push({
        x, y, width, height, fillStyle: this.fillStyle, font: this.font,
      });
    },
    fillText(text, x, y) {
      calls.texts.push({
        text, x, y, fillStyle: this.fillStyle, font: this.font,
      });
    },
  };
  return { ctx, calls };
}

let canvasClientWidth;
let canvasClientHeight;
let devicePixelRatio;

function queuedMember(remaining = 100, maximum = 100, overrides = {}) {
  return {
    patience: remaining,
    patienceMax: maximum,
    queuePatience: remaining,
    queuePatienceMax: maximum,
    ...overrides,
  };
}

beforeEach(() => {
  canvasClientWidth = 300;
  canvasClientHeight = 120;
  devicePixelRatio = 1;
  vi.stubGlobal('ResizeObserver', undefined);
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => canvasClientWidth,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => canvasClientHeight,
  });
  Object.defineProperty(window, 'devicePixelRatio', {
    configurable: true,
    get: () => devicePixelRatio,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
  }));
  mockUseGameState.mockReturnValue(baseState);
  mockUseDispatch.mockClear();
  requestNewSandboxMock.mockClear();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows empty party review aggregates', () => {
  render(<StatsPanel />);
  expect(screen.getByText('Average party review: —')).toBeInTheDocument();
  expect(screen.getByText('Completed reviews: 0')).toBeInTheDocument();
});

it('mounts table seating holds as a separate statistics section', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    tables: [{ id: 'stats-table', status: 'empty' }],
  });
  render(<StatsPanel />);

  const holds = screen.getByRole('region', { name: 'Table seating holds' });
  expect(within(holds).getByRole('heading', { name: 'Table seating holds' }))
    .toBeInTheDocument();
  expect(within(holds).getByRole('button', { name: 'Hold seating for table stats-table' }))
    .toBeEnabled();
  expect(within(screen.getByRole('region', { name: 'Service now' }))
    .queryByRole('button', { name: /seating for table/ })).not.toBeInTheDocument();

  fireEvent.click(within(holds).getByRole('button', {
    name: 'Hold seating for table stats-table',
  }));
  expect(mockUseDispatch).toHaveBeenCalledWith({
    type: 'SET_TABLE_ADMISSION_HOLD', id: 'stats-table', held: true,
  });
});

it('shows aggregates and only the latest ten reviews newest first', () => {
  const scores = [-50, -5, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const partyReviewHistory = scores.map((score, index) => {
    const unaffordableCount = index % 3 === 0 ? 1 : 0;
    const poorValueCount = index % 4 === 0 && unaffordableCount === 0 ? 1 : 0;
    return {
      partyId: `p${index + 1}`,
      day: index + 1,
      score,
      memberCount: 2,
      paidCount: 2 - unaffordableCount - poorValueCount,
      unaffordableCount,
      poorValueCount,
      reputationDelta: score * 2 / 5000,
    };
  });
  mockUseGameState.mockReturnValue({
    ...baseState,
    partyReviewHistory,
  });
  render(<StatsPanel />);

  expect(screen.getByText('Average party review: 32.9')).toBeInTheDocument();
  expect(screen.getByText('Completed reviews: 12')).toBeInTheDocument();
  expect(screen.getByText('Reviews with unaffordable members: 4 (33%)')).toBeInTheDocument();
  expect(screen.getByText('Reviews with poor-value members: 2 (17%)')).toBeInTheDocument();
  const rows = screen.getAllByTestId('party-review-row');
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent('Day 12 · p12');
  expect(rows[0]).toHaveTextContent('Score: 90.0');
  expect(rows[0]).toHaveTextContent('Party: 2 · Paid: 2 · Unaffordable: 0 · Poor value: 0');
  expect(rows[0]).toHaveTextContent('Reputation: +0.036');
  expect(rows.at(-1)).toHaveTextContent('Day 3 · p3');
  expect(screen.queryByText(/p1$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/p2$/)).not.toBeInTheDocument();
  expect(screen.getAllByTestId('party-review-day-row')).toHaveLength(7);
});

describe('Retained review day trend', () => {
  it('provides an accessible region, list, empty feedback, and sample caveat', () => {
    render(<StatsPanel />);

    const region = screen.getByRole('region', { name: 'Retained review day trend' });
    expect(within(region).getByRole('heading', { name: 'Retained review day trend' }))
      .toBeInTheDocument();
    expect(within(region).getByRole('list', { name: 'Retained review days' }))
      .toBeInTheDocument();
    expect(within(region).getByRole('status'))
      .toHaveTextContent('No retained party reviews by day yet.');
    expect(within(region).getByText(/Each party contributes one score/)).toBeInTheDocument();
    expect(within(region).getByText(/may truncate even one day's reviews/)).toBeInTheDocument();
    expect(within(region).getByText(/not necessarily consecutive/)).toBeInTheDocument();
    expect(within(region).getByText(/missing days are omitted, not zero-filled/i))
      .toBeInTheDocument();
  });

  it('shows sparse day rows, equal-party means, separate refusal shares, and a seven-day cutoff', () => {
    const partyReviewHistory = [
      { partyId: 'day-3', day: 3, score: 30, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-25-small', day: 25, score: 80, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-9', day: 9, score: 9, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-5', day: 5, score: 5, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-20', day: 20, score: 20, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-8', day: 8, score: 8, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-15', day: 15, score: 15, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-12', day: 12, score: 12, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-21', day: 21, score: 21, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-24', day: 24, score: 24, memberCount: 1, paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0 },
      { partyId: 'day-25-large', day: 25, score: 20, memberCount: 4, paidCount: 1, unaffordableCount: 1, poorValueCount: 2, reputationDelta: 0 },
    ];
    mockUseGameState.mockReturnValue({ ...baseState, partyReviewHistory });
    render(<StatsPanel />);

    const region = screen.getByRole('region', { name: 'Retained review day trend' });
    const list = within(region).getByRole('list', { name: 'Retained review days' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(7);
    expect(rows.map(row => row.textContent)).toEqual([
      'Day 25 · 2 party reviews · Mean score 50.0 · Parties with unaffordable members: 1 of 2 (50%) · Parties with poor-value members: 1 of 2 (50%)',
      'Day 24 · 1 party reviews · Mean score 24.0 · Parties with unaffordable members: 0 of 1 (0%) · Parties with poor-value members: 0 of 1 (0%)',
      'Day 21 · 1 party reviews · Mean score 21.0 · Parties with unaffordable members: 0 of 1 (0%) · Parties with poor-value members: 0 of 1 (0%)',
      'Day 20 · 1 party reviews · Mean score 20.0 · Parties with unaffordable members: 0 of 1 (0%) · Parties with poor-value members: 0 of 1 (0%)',
      'Day 15 · 1 party reviews · Mean score 15.0 · Parties with unaffordable members: 0 of 1 (0%) · Parties with poor-value members: 0 of 1 (0%)',
      'Day 12 · 1 party reviews · Mean score 12.0 · Parties with unaffordable members: 0 of 1 (0%) · Parties with poor-value members: 0 of 1 (0%)',
      'Day 9 · 1 party reviews · Mean score 9.0 · Parties with unaffordable members: 0 of 1 (0%) · Parties with poor-value members: 0 of 1 (0%)',
    ]);
  });

  it('shows unavailable for a non-finite aggregate and rerenders without dispatch while a career decision is pending', () => {
    const firstHistory = [{
      partyId: 'large-one', day: 1, score: Number.MAX_VALUE, memberCount: 1,
      paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0,
    }, {
      partyId: 'large-two', day: 1, score: Number.MAX_VALUE, memberCount: 1,
      paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0,
    }];
    mockUseGameState.mockReturnValue({
      ...baseState,
      careerRun: { needsDecision: true },
      partyReviewHistory: firstHistory,
    });
    const { rerender } = render(<StatsPanel />);

    let region = screen.getByRole('region', { name: 'Retained review day trend' });
    expect(within(region).getByRole('listitem')).toHaveTextContent('Mean score Unavailable');
    expect(mockUseDispatch).not.toHaveBeenCalled();

    mockUseGameState.mockReturnValue({
      ...baseState,
      careerRun: { needsDecision: true },
      partyReviewHistory: [{
        partyId: 'new-day', day: 3, score: 30, memberCount: 1,
        paidCount: 1, unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0,
      }],
    });
    rerender(<StatsPanel />);

    region = screen.getByRole('region', { name: 'Retained review day trend' });
    expect(within(region).getByRole('listitem')).toHaveTextContent('Day 3 · 1 party reviews');
    expect(mockUseDispatch).not.toHaveBeenCalled();
  });
});

it('shows an empty service snapshot with the pending stage labels', () => {
  render(<StatsPanel />);
  const section = screen.getByRole('region', { name: 'Service now' });
  expect(screen.getByRole('heading', { name: 'Service now' })).toBeInTheDocument();
  expect(within(section).getByText('Entry queue: 0 parties · 0 guests')).toBeInTheDocument();
  for (const label of ['Awaiting preparation', 'In preparation', 'Ready for collection',
    'On service counter', 'Being carried']) {
    expect(within(section).getByText(`${label}: 0`)).toBeInTheDocument();
  }
  expect(within(section).getByText('Pending service items (dishes + drinks)')).toBeInTheDocument();
  expect(within(section).getByText('Current counts, not totals. One guest may order multiple items. '
    + 'Queue includes guests not shown outside. Delivered items and cleanup are excluded.')).toBeInTheDocument();
});

it('shows distinct current queue and pending service counts, excluding delivered and cleanup items', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'p1', members: [{ id: 'a' }, { id: 'b' }] },
      { partyId: 'p2', members: [{ id: 'c' }] },
    ],
    customers: [
      { id: 'c1', state: 'waiting', foodOutcome: null, cancelledServiceItemIds: [] },
      { id: 'c2', state: 'leaving', foodOutcome: null, cancelledServiceItemIds: [] },
    ],
    serviceItems: [
      { id: 'ordered-1', customerId: 'c1', kind: 'dish', state: 'ordered' },
      { id: 'preparing-1', customerId: 'c1', kind: 'dish', state: 'preparing' },
      { id: 'preparing-2', customerId: 'c1', kind: 'drink', state: 'preparing' },
      { id: 'ready-1', customerId: 'c1', kind: 'dish', state: 'ready' },
      { id: 'ready-2', customerId: 'c1', kind: 'drink', state: 'ready' },
      { id: 'ready-3', customerId: 'c1', kind: 'dish', state: 'ready' },
      { id: 'on-service-1', customerId: 'c1', kind: 'dish', state: 'on_service' },
      { id: 'on-service-2', customerId: 'c1', kind: 'drink', state: 'on_service' },
      { id: 'on-service-3', customerId: 'c1', kind: 'dish', state: 'on_service' },
      { id: 'on-service-4', customerId: 'c1', kind: 'drink', state: 'on_service' },
      { id: 'carried-1', customerId: 'c1', kind: 'dish', state: 'carried' },
      { id: 'carried-2', customerId: 'c1', kind: 'drink', state: 'carried' },
      { id: 'carried-3', customerId: 'c1', kind: 'dish', state: 'carried' },
      { id: 'carried-4', customerId: 'c1', kind: 'drink', state: 'carried' },
      { id: 'carried-5', customerId: 'c1', kind: 'dish', state: 'carried' },
      { id: 'delivered-1', customerId: 'c1', kind: 'dish', state: 'delivered' },
      { id: 'cleanup-1', customerId: 'c1', kind: 'drink', state: 'to_clean' },
      { id: 'leaving-1', customerId: 'c2', kind: 'dish', state: 'ready' },
    ],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Service now' });
  expect(within(section).getByText('Entry queue: 2 parties · 3 guests')).toBeInTheDocument();
  expect(within(section).getByText('Awaiting preparation: 1')).toBeInTheDocument();
  expect(within(section).getByText('In preparation: 2')).toBeInTheDocument();
  expect(within(section).getByText('Ready for collection: 3')).toBeInTheDocument();
  expect(within(section).getByText('On service counter: 4')).toBeInTheDocument();
  expect(within(section).getByText('Being carried: 5')).toBeInTheDocument();
  expect(screen.getByText(/Total served:/)).toHaveTextContent('Total served: 0');
  expect(screen.getByText(/Funds:/)).toHaveTextContent('Funds: $600');
});

it('shows the accessible cleanup backlog separately from pending service', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    tables: [
      { status: 'dirty' },
      { status: 'occupied' },
      { status: 'cleaning' },
    ],
    serviceItems: [
      { kind: 'dish', state: 'dirty_at_table', customerId: null },
      { kind: 'drink', state: 'dirty_at_table', customerId: 'missing-owner' },
      { kind: 'dish', state: 'carried_dirty' },
      { kind: 'drink', state: 'queued_for_wash' },
      { kind: 'dish', state: 'washing' },
      { kind: 'dish', state: 'to_clean' },
      { kind: 'napkin', state: 'washing' },
    ],
  });
  render(<StatsPanel />);

  const cleanup = screen.getByRole('region', { name: 'Cleanup backlog' });
  expect(within(cleanup).getByRole('heading', { name: 'Cleanup backlog' })).toBeInTheDocument();
  expect(within(cleanup).getByText('Dirty tables awaiting cleaning: 1')).toBeInTheDocument();
  expect(within(cleanup).getByText('Dirty items awaiting collection: 2')).toBeInTheDocument();
  expect(within(cleanup).getByText('Carried dirty items: 1')).toBeInTheDocument();
  expect(within(cleanup).getByText('Queued for washing: 1')).toBeInTheDocument();
  expect(within(cleanup).getByText('Being washed: 1')).toBeInTheDocument();
  expect(within(cleanup).getByText('Current counts, not clearance estimates. Dirty tables are not '
    + 'all unavailable tables. Floor messes and discarded food waste are excluded.'))
    .toBeInTheDocument();

  const service = screen.getByRole('region', { name: 'Service now' });
  expect(within(service).getByText('Pending service items (dishes + drinks)')).toBeInTheDocument();
  expect(within(service).getByText('Awaiting preparation: 0')).toBeInTheDocument();
  expect(within(service).getByText('Being carried: 0')).toBeInTheDocument();
  expect(within(service).getByText('Current counts, not totals. One guest may order multiple items. '
    + 'Queue includes guests not shown outside. Delivered items and cleanup are excluded.'))
    .toBeInTheDocument();
  expect(within(service).queryByText('Dirty items awaiting collection: 2')).not.toBeInTheDocument();
});

it('rerenders updated cleanup counts after an immutable state replacement', () => {
  const { rerender } = render(<StatsPanel />);
  const cleanup = screen.getByRole('region', { name: 'Cleanup backlog' });
  expect(within(cleanup).getByText('Dirty tables awaiting cleaning: 0')).toBeInTheDocument();
  expect(within(cleanup).getByText('Dirty items awaiting collection: 0')).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    tables: [{ status: 'dirty' }, { status: 'dirty' }, { status: 'occupied' }],
    serviceItems: [
      { kind: 'dish', state: 'dirty_at_table' },
      { kind: 'drink', state: 'carried_dirty' },
      { kind: 'dish', state: 'queued_for_wash' },
      { kind: 'drink', state: 'washing' },
    ],
  });
  rerender(<StatsPanel />);

  const updated = screen.getByRole('region', { name: 'Cleanup backlog' });
  expect(within(updated).getByText('Dirty tables awaiting cleaning: 2')).toBeInTheDocument();
  expect(within(updated).getByText('Dirty items awaiting collection: 1')).toBeInTheDocument();
  expect(within(updated).getByText('Carried dirty items: 1')).toBeInTheDocument();
  expect(within(updated).getByText('Queued for washing: 1')).toBeInTheDocument();
  expect(within(updated).getByText('Being washed: 1')).toBeInTheDocument();
  expect(within(updated).queryByText('Dirty tables awaiting cleaning: 0')).not.toBeInTheDocument();
});

it('rerenders updated queue and stage counts after an immutable state replacement', () => {
  const { rerender } = render(<StatsPanel />);
  const initial = screen.getByRole('region', { name: 'Service now' });
  expect(within(initial).getByText('Entry queue: 0 parties · 0 guests')).toBeInTheDocument();
  expect(within(initial).getByText('Being carried: 0')).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'p1', members: [{ id: 'a' }, { id: 'b' }] },
      { partyId: 'p2', members: [{ id: 'c' }] },
    ],
    customers: [{ id: 'c1', state: 'waiting', foodOutcome: null, cancelledServiceItemIds: [] }],
    serviceItems: [
      { id: 'i1', customerId: 'c1', kind: 'dish', state: 'preparing' },
      { id: 'i2', customerId: 'c1', kind: 'drink', state: 'on_service' },
    ],
  });
  rerender(<StatsPanel />);

  const updated = screen.getByRole('region', { name: 'Service now' });
  expect(within(updated).getByText('Entry queue: 2 parties · 3 guests')).toBeInTheDocument();
  expect(within(updated).getByText('In preparation: 1')).toBeInTheDocument();
  expect(within(updated).getByText('On service counter: 1')).toBeInTheDocument();
  expect(within(updated).queryByText('Entry queue: 0 parties · 0 guests')).not.toBeInTheDocument();
});

it('shows no waiting parties in the queue patience list when the queue is empty', () => {
  render(<StatsPanel />);
  expect(screen.getByRole('heading', { name: 'Queue patience' })).toBeInTheDocument();
  expect(screen.getByText('No parties waiting.')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Queue patience' })).not.toBeInTheDocument();
  expect(screen.getByText('All queued parties are included, even those not shown outside. '
    + 'A party leaves when any guest runs out of queue patience. Percentages show the '
    + "lowest-remaining guest's share of their own maximum. At current queue pressure, "
    + 'assuming no seating, arrivals or closing. This is game time until patience runs '
    + 'out, not a seating wait estimate. Pausing the simulation stops the countdown.')).toBeInTheDocument();
});

it('lists every queued party with logical ordinals and actual guest counts', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'p1', members: [queuedMember(100, 100), queuedMember(100, 100, { partySize: 99 })] },
      { partyId: 'p2', members: [queuedMember(100, 100)] },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Party 1: 2 guests');
  expect(rows[1]).toHaveTextContent('Party 2: 1 guest');

  const section = screen.getByRole('region', { name: 'Service now' });
  expect(within(section).getByText('Entry queue: 2 parties · 3 guests')).toBeInTheDocument();
});

it('offers opaque per-party priority controls and disables the first and career-gated actions', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'opaque-first', members: [queuedMember()] },
      { partyId: 'opaque-selected', members: [queuedMember()] },
    ],
  });
  const { rerender } = render(<StatsPanel />);

  const first = screen.getByRole('button', { name: 'Prioritise party opaque-first' });
  const selected = screen.getByRole('button', { name: 'Prioritise party opaque-selected' });
  expect(first).toBeDisabled();
  expect(selected).toBeEnabled();
  expect(screen.getByText(/Priority changes consideration order only; it does not seat a party immediately or move anyone physically in line, and may delay older parties\./))
    .toBeInTheDocument();
  fireEvent.click(selected);
  expect(mockUseDispatch).toHaveBeenCalledWith({
    type: 'PRIORITISE_QUEUE_PARTY', partyId: 'opaque-selected',
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(document.querySelector('[aria-live="assertive"]')).toBeNull();

  mockUseDispatch.mockClear();
  mockUseGameState.mockReturnValue({
    ...baseState,
    careerRun: { needsDecision: true },
    queue: [
      { partyId: 'career-first', members: [queuedMember()] },
      { partyId: 'career-second', members: [queuedMember()] },
    ],
  });
  rerender(<StatsPanel />);
  const careerFirst = screen.getByRole('button', { name: 'Prioritise party career-first' });
  const careerSecond = screen.getByRole('button', { name: 'Prioritise party career-second' });
  expect(careerFirst).toBeDisabled();
  expect(careerSecond).toBeDisabled();
  careerSecond.disabled = false;
  fireEvent.click(careerSecond);
  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it('shows divergent percentages per party and uses the maximum of tied lowest guests', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'p1', members: [queuedMember(10, 20), queuedMember(20, 100)] },
      { partyId: 'p2', members: [queuedMember(10, 20), queuedMember(10, 100)] },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Lowest-remaining guest: 50% patience')).toBeInTheDocument();
  expect(within(list).getByText('Lowest-remaining guest: 10% patience')).toBeInTheDocument();
});

it('shows unknown and exhausted statuses without percentages', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'unknown', members: [queuedMember(NaN, 100)] },
      { partyId: 'exhausted', members: [queuedMember(0, 100)] },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Patience unknown')).toBeInTheDocument();
  expect(within(list).getByText('Patience exhausted')).toBeInTheDocument();
});

it('formats tiny positive, near-full and exact-full fractions distinctly', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'tiny', members: [queuedMember(0.000001, 100)] },
      { partyId: 'partial', members: [queuedMember(9999.5, 10000)] },
      { partyId: 'full', members: [queuedMember(100, 100)] },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Lowest-remaining guest: <1% patience')).toBeInTheDocument();
  expect(within(list).getByText('Lowest-remaining guest: >99% patience')).toBeInTheDocument();
  expect(within(list).getByText('Lowest-remaining guest: 100% patience')).toBeInTheDocument();
});

it('rerenders queue patience immutably and includes all parties when no queueSlots exist', () => {
  const { rerender } = render(<StatsPanel />);
  expect(screen.getByText('No parties waiting.')).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'p1', members: [queuedMember(10, 20)] },
      { partyId: 'p2', members: [queuedMember(25, 100)] },
      { partyId: 'p3', members: [queuedMember(0, 100)] },
    ],
  });
  rerender(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(within(list).getByText('Lowest-remaining guest: 50% patience')).toBeInTheDocument();
  expect(within(list).getByText('Lowest-remaining guest: 25% patience')).toBeInTheDocument();
  expect(within(list).getByText('Patience exhausted')).toBeInTheDocument();
  expect(screen.queryByText('No parties waiting.')).not.toBeInTheDocument();
});

it('keeps party reviews and Service now alongside the queue patience list', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [{ partyId: 'p1', members: [queuedMember(10, 20)] }],
    partyReviewHistory: [{
      partyId: 'p1', day: 2, score: 80, memberCount: 2, paidCount: 2,
      unaffordableCount: 0, poorValueCount: 0, reputationDelta: 0.032,
    }],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Party 1: 1 guest')).toBeInTheDocument();
  expect(screen.getByText('Average party review: 80.0')).toBeInTheDocument();
  expect(screen.getByText('Completed reviews: 1')).toBeInTheDocument();
  const section = screen.getByRole('region', { name: 'Service now' });
  expect(within(section).getByText('Entry queue: 1 parties · 1 guests')).toBeInTheDocument();
});

it('shows fractional funds to the cent and a projected midnight payroll balance', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, funds: 622.5 },
    staff: [{ id: 's1', salary: 150.25 }],
  });
  render(<StatsPanel />);

  expect(screen.getByText(/Funds:/)).toHaveTextContent('Funds: $622.50');
  const section = screen.getByRole('region', { name: 'Midnight payroll' });
  expect(within(section).getByRole('heading', { name: 'Midnight payroll' })).toBeInTheDocument();
  expect(within(section).getByText(/Daily payroll:/)).toHaveTextContent('Daily payroll: $150.25');
  expect(within(section).getByText(/Balance after payroll at current funds:/))
    .toHaveTextContent('Balance after payroll at current funds: $472.25');
  expect(within(section).getByText(
    'All employed staff are paid at midnight, including during Rest and PTO. '
    + 'This estimate excludes future sales and spending.',
  )).toBeInTheDocument();
  expect(within(section).queryByText('Current funds do not cover the next payroll.'))
    .not.toBeInTheDocument();
});

it('renders whole-dollar payroll and balance values without decimals', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, funds: 600 },
    staff: [{ id: 's1', salary: 150 }],
  });
  render(<StatsPanel />);

  expect(screen.getByText(/Funds:/)).toHaveTextContent('Funds: $600');
  const section = screen.getByRole('region', { name: 'Midnight payroll' });
  expect(within(section).getByText(/Daily payroll:/)).toHaveTextContent('Daily payroll: $150');
  expect(within(section).getByText(/Balance after payroll at current funds:/))
    .toHaveTextContent('Balance after payroll at current funds: $450');
});

it('shows an unclamped negative balance and the uncovered payroll notice', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, funds: 100 },
    staff: [{ id: 's1', salary: 150 }],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Midnight payroll' });
  expect(within(section).getByText(/Daily payroll:/)).toHaveTextContent('Daily payroll: $150');
  expect(within(section).getByText(/Balance after payroll at current funds:/))
    .toHaveTextContent('Balance after payroll at current funds: $-50');
  expect(within(section).getByText('Current funds do not cover the next payroll.'))
    .toBeInTheDocument();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY])(
  'shows Unavailable for non-finite funds (%s) without a coverage claim',
  (funds) => {
    mockUseGameState.mockReturnValue({
      ...baseState,
      restaurant: { ...baseState.restaurant, funds },
      staff: [{ id: 's1', salary: 150 }],
    });
    render(<StatsPanel />);

    expect(screen.getByText(/Funds:/)).toHaveTextContent('Funds: Unavailable');
    const section = screen.getByRole('region', { name: 'Midnight payroll' });
    expect(within(section).getByText(/Daily payroll:/)).toHaveTextContent('Daily payroll: $150');
    expect(within(section).getByText(/Balance after payroll at current funds:/))
      .toHaveTextContent('Balance after payroll at current funds: Unavailable');
    expect(within(section).queryByText('Current funds do not cover the next payroll.'))
      .not.toBeInTheDocument();
  },
);

it('rerenders payroll and balance for changed staff and funds without mutating them', () => {
  const firstStaff = Object.freeze([
    Object.freeze({ id: 's1', salary: 100 }),
    Object.freeze({ id: 's2', salary: 50.5 }),
  ]);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, funds: 600 },
    staff: firstStaff,
  });
  const { rerender } = render(<StatsPanel />);

  let section = screen.getByRole('region', { name: 'Midnight payroll' });
  expect(within(section).getByText(/Daily payroll:/)).toHaveTextContent('Daily payroll: $150.50');
  expect(within(section).getByText(/Balance after payroll at current funds:/))
    .toHaveTextContent('Balance after payroll at current funds: $449.50');

  const secondStaff = Object.freeze([Object.freeze({ id: 's1', salary: 200.25 })]);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, funds: 300 },
    staff: secondStaff,
  });
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Midnight payroll' });
  expect(within(section).getByText(/Daily payroll:/)).toHaveTextContent('Daily payroll: $200.25');
  expect(within(section).getByText(/Balance after payroll at current funds:/))
    .toHaveTextContent('Balance after payroll at current funds: $99.75');
  expect(screen.getByText(/Funds:/)).toHaveTextContent('Funds: $300');
  expect(firstStaff.map(member => member.salary)).toEqual([100, 50.5]);
  expect(secondStaff[0].salary).toBe(200.25);
});

it('shows the per-party game-time estimate alongside the existing patience text', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [{ partyId: 'p1', members: [queuedMember(120, 120)] }],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Lowest-remaining guest: 100% patience')).toBeInTheDocument();
  expect(within(list).getByText(
    'Estimated time until patience runs out: 2m 00s (game time).',
  )).toBeInTheDocument();
});

it('shows seconds under a minute and rounds a partial minute up', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [{ partyId: 'p1', members: [queuedMember(6, 100)] }],
  });
  const { rerender } = render(<StatsPanel />);
  let list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText(
    'Estimated time until patience runs out: 6s (game time).',
  )).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [{ partyId: 'p1', members: [queuedMember(59.2, 100)] }],
  });
  rerender(<StatsPanel />);
  list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText(
    'Estimated time until patience runs out: 1m 00s (game time).',
  )).toBeInTheDocument();
});

it('shows 0s for exhausted parties and <1s for a tiny positive remainder', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'exhausted', members: [queuedMember(0, 100)] },
      { partyId: 'tiny', members: [queuedMember(0.4, 100)] },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Patience exhausted')).toBeInTheDocument();
  expect(within(list).getByText(
    'Estimated time until patience runs out: 0s (game time).',
  )).toBeInTheDocument();
  expect(within(list).getByText(
    'Estimated time until patience runs out: <1s (game time).',
  )).toBeInTheDocument();
});

it('shows an unavailable estimate for unknown parties', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [{ partyId: 'unknown', members: [queuedMember(NaN, 100)] }],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText('Patience unknown')).toBeInTheDocument();
  expect(within(list).getByText('Patience time estimate unavailable.')).toBeInTheDocument();
});

it('recomputes the estimate from queue pressure and opening hours across rerenders', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [{ partyId: 'p1', members: [queuedMember(100, 100)] }],
  });
  const { rerender } = render(<StatsPanel />);
  let list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText(
    'Estimated time until patience runs out: 1m 40s (game time).',
  )).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [
      { partyId: 'p1', members: [queuedMember(100, 100)] },
      { partyId: 'p2', members: [queuedMember(100, 100)] },
    ],
  });
  rerender(<StatsPanel />);
  list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).queryByText(
    'Estimated time until patience runs out: 1m 40s (game time).',
  )).not.toBeInTheDocument();
  expect(within(list).getAllByText(
    'Estimated time until patience runs out: 1m 31s (game time).',
  )).toHaveLength(2);

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: {
      ...baseState.restaurant, gameTime: 20 * 3600, openHour: 9, closeHour: 17,
    },
    queue: [{ partyId: 'p1', members: [queuedMember(100, 100)] }],
  });
  rerender(<StatsPanel />);
  list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText(
    'Patience time estimate unavailable while closed.',
  )).toBeInTheDocument();
});

it('uses actual opening hours rather than the walk-ins pause flag for the estimate', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: {
      ...baseState.restaurant, gameTime: 10 * 3600, openHour: 9, closeHour: 17, walkInsPaused: true,
    },
    queue: [{ partyId: 'p1', members: [queuedMember(100, 100)] }],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(list).getByText(
    'Estimated time until patience runs out: 1m 40s (game time).',
  )).toBeInTheDocument();
  expect(within(list).queryByText(
    'Patience time estimate unavailable while closed.',
  )).not.toBeInTheDocument();
});

it('shows current-day revenue, payroll and difference separately from completed history', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 622.5 },
    staff: [{ id: 's1', salary: 150.25 }],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(section).getByRole('heading', { name: 'Current-day finances' })).toBeInTheDocument();
  expect(within(section).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: $622.50');
  expect(within(section).getByText(/Current daily payroll:/))
    .toHaveTextContent('Current daily payroll: $150.25');
  expect(within(section).getByText(/Revenue so far minus current payroll:/))
    .toHaveTextContent('Revenue so far minus current payroll: $472.25');
  expect(within(section).getByText(
    'In progress. This compares revenue received so far with the current full daily payroll. '
    + 'It is not cash balance or a forecast; future sales, staffing changes and other receipts '
    + 'or spending are excluded.',
  )).toBeInTheDocument();

  const completed = screen.getByRole('region', { name: 'Completed-day finances' });
  expect(completed).not.toBe(section);
  expect(within(completed).queryByText(/Revenue so far:/)).not.toBeInTheDocument();
  expect(within(section).queryByText('No completed-day finances yet.')).not.toBeInTheDocument();
});

it('shows a negative current-day difference without clamping', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 100 },
    staff: [{ id: 's1', salary: 150.25 }],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(section).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: $100');
  expect(within(section).getByText(/Revenue so far minus current payroll:/))
    .toHaveTextContent('Revenue so far minus current payroll: $-50.25');
});

it('shows zero current-day revenue, payroll and difference as zero', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 0 },
    staff: [],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(section).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: $0');
  expect(within(section).getByText(/Current daily payroll:/))
    .toHaveTextContent('Current daily payroll: $0');
  expect(within(section).getByText(/Revenue so far minus current payroll:/))
    .toHaveTextContent('Revenue so far minus current payroll: $0');
});

it('shows Unavailable for a missing current-day revenue instead of defaulting it to zero', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    staff: [{ id: 's1', salary: 150.25 }],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(section).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: Unavailable');
  expect(within(section).getByText(/Current daily payroll:/))
    .toHaveTextContent('Current daily payroll: $150.25');
  expect(within(section).getByText(/Revenue so far minus current payroll:/))
    .toHaveTextContent('Revenue so far minus current payroll: Unavailable');
  expect(within(section).queryByText('Revenue so far: $0')).not.toBeInTheDocument();
});

it.each([Number.NaN, Number.POSITIVE_INFINITY])(
  'shows Unavailable for a non-finite current-day revenue (%s)',
  (dailyRevenue) => {
    mockUseGameState.mockReturnValue({
      ...baseState,
      restaurant: { ...baseState.restaurant, dailyRevenue },
      staff: [{ id: 's1', salary: 150.25 }],
    });
    render(<StatsPanel />);

    const section = screen.getByRole('region', { name: 'Current-day finances' });
    expect(within(section).getByText(/Revenue so far:/))
      .toHaveTextContent('Revenue so far: Unavailable');
    expect(within(section).getByText(/Current daily payroll:/))
      .toHaveTextContent('Current daily payroll: $150.25');
    expect(within(section).getByText(/Revenue so far minus current payroll:/))
      .toHaveTextContent('Revenue so far minus current payroll: Unavailable');
  },
);

it('resets current-day finances when the next day starts', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, day: 1, dailyRevenue: 622.5 },
    staff: [{ id: 's1', salary: 150.25 }],
  });
  const { rerender } = render(<StatsPanel />);

  let section = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(section).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: $622.50');
  expect(within(section).getByText(/Revenue so far minus current payroll:/))
    .toHaveTextContent('Revenue so far minus current payroll: $472.25');

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, day: 2, dailyRevenue: 0 },
    staff: [{ id: 's1', salary: 150.25 }],
  });
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(section).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: $0');
  expect(within(section).getByText(/Revenue so far minus current payroll:/))
    .toHaveTextContent('Revenue so far minus current payroll: $-150.25');
  expect(within(section).queryByText(/622/)).not.toBeInTheDocument();
});

it('keeps frozen completed-day history and records unchanged while showing current-day finances', () => {
  const completedRecord = Object.freeze({
    day: 1, revenue: 622.5, payroll: 150.25, profit: 472.25,
  });
  const dailyHistory = Object.freeze([completedRecord]);
  const snapshot = JSON.stringify(dailyHistory);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 777.25 },
    dailyHistory,
    staff: [{ id: 's1', salary: 150.25 }],
  });
  render(<StatsPanel />);

  const current = screen.getByRole('region', { name: 'Current-day finances' });
  expect(within(current).getByText(/Revenue so far:/)).toHaveTextContent('Revenue so far: $777.25');
  const completed = screen.getByRole('region', { name: 'Completed-day finances' });
  const rows = within(completed).getAllByRole('listitem');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent('Day 1');
  expect(rows[0]).toHaveTextContent('Revenue: $622.50');
  expect(rows[0]).toHaveTextContent('Payroll: $150.25');
  expect(rows[0]).toHaveTextContent('Profit: $472.25');
  expect(JSON.stringify(dailyHistory)).toBe(snapshot);
  expect(completedRecord).toEqual({
    day: 1, revenue: 622.5, payroll: 150.25, profit: 472.25,
  });
});

it('shows an empty completed-day finances section below the revenue chart', () => {
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Completed-day finances' });
  expect(within(section).getByRole('heading', { name: 'Completed-day finances' })).toBeInTheDocument();
  expect(within(section).getByText('No completed-day finances yet.')).toBeInTheDocument();
  expect(within(section).queryByRole('region', { name: 'Recent finance summary' }))
    .not.toBeInTheDocument();
  expect(within(section).getByText(
    'Last seven recorded entries; day labels may be duplicated or non-consecutive. '
    + 'Stored profit is revenue minus payroll, not total cash movement; '
    + 'other receipts and spending are excluded.',
  )).toBeInTheDocument();
  expect(within(section).queryByRole('list', { name: 'Recent daily finances' })).not.toBeInTheDocument();

  const canvas = document.querySelector('canvas');
  expect(canvas.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it('lists only the latest seven completed days as an ordered list newest first', () => {
  const dailyHistory = Array.from({ length: 9 }, (_, index) => ({
    day: index + 1,
    revenue: 100 + index,
    payroll: 50,
    profit: 50 + index,
  }));
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Recent daily finances' });
  expect(list.tagName).toBe('OL');
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(7);
  expect(rows[0]).toHaveTextContent('Day 9');
  expect(rows[0]).toHaveTextContent('Revenue: $108');
  expect(rows[0]).toHaveTextContent('Payroll: $50');
  expect(rows[0]).toHaveTextContent('Profit: $58');
  expect(rows[6]).toHaveTextContent('Day 3');
  expect(rows[6]).toHaveTextContent('Revenue: $102');
  expect(within(list).queryByText('Day 1')).not.toBeInTheDocument();
  expect(within(list).queryByText('Day 2')).not.toBeInTheDocument();
});

it('shows exact fractional stored revenue, payroll and profit without the open day', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 777.25 },
    dailyHistory: [{ day: 4, revenue: 622.5, payroll: 150.25, profit: 472.25 }],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Recent daily finances' });
  const row = within(list).getAllByRole('listitem')[0];
  expect(row).toHaveTextContent('Day 4');
  expect(row).toHaveTextContent('Revenue: $622.50');
  expect(row).toHaveTextContent('Payroll: $150.25');
  expect(row).toHaveTextContent('Profit: $472.25');
  expect(within(list).queryByText(/777/)).not.toBeInTheDocument();
});

it('shows a stored negative profit without clamping or recalculation', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 2, revenue: 10, payroll: 25.5, profit: -15.5 }],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Recent daily finances' });
  const row = within(list).getAllByRole('listitem')[0];
  expect(row).toHaveTextContent('Revenue: $10');
  expect(row).toHaveTextContent('Payroll: $25.50');
  expect(row).toHaveTextContent('Profit: $-15.50');
});

it('shows Unavailable for missing or nonfinite legacy payroll and profit instead of inferring them', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: 1, revenue: 200 },
      { day: 2, revenue: 300, payroll: 40 },
      { day: 3, revenue: 500, profit: 100 },
      { day: 4, revenue: Number.POSITIVE_INFINITY, payroll: Number.NaN, profit: 10 },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Recent daily finances' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows[3]).toHaveTextContent('Day 1');
  expect(rows[3]).toHaveTextContent('Revenue: $200');
  expect(rows[3]).toHaveTextContent('Payroll: Unavailable');
  expect(rows[3]).toHaveTextContent('Profit: Unavailable');
  expect(rows[2]).toHaveTextContent('Revenue: $300');
  expect(rows[2]).toHaveTextContent('Payroll: $40');
  expect(rows[2]).toHaveTextContent('Profit: Unavailable');
  expect(rows[1]).toHaveTextContent('Revenue: $500');
  expect(rows[1]).toHaveTextContent('Payroll: Unavailable');
  expect(rows[1]).toHaveTextContent('Profit: $100');
  expect(rows[0]).toHaveTextContent('Revenue: Unavailable');
  expect(rows[0]).toHaveTextContent('Payroll: Unavailable');
  expect(rows[0]).toHaveTextContent('Profit: $10');
});

it('shows Day unavailable for nonfinite or missing days while other fields still render', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: Number.NaN, revenue: 100, payroll: 50, profit: 50 },
      { revenue: 80, payroll: 30, profit: 50 },
    ],
  });
  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Recent daily finances' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('Day unavailable');
  expect(rows[0]).toHaveTextContent('Revenue: $80');
  expect(rows[0]).toHaveTextContent('Payroll: $30');
  expect(rows[0]).toHaveTextContent('Profit: $50');
  expect(rows[1]).toHaveTextContent('Day unavailable');
  expect(rows[1]).toHaveTextContent('Revenue: $100');
  expect(rows[1]).toHaveTextContent('Payroll: $50');
  expect(rows[1]).toHaveTextContent('Profit: $50');
});

it('leaves a frozen daily history unchanged and in stored order', () => {
  const dailyHistory = Object.freeze([
    Object.freeze({ day: 1, revenue: 10, payroll: 4, profit: 6 }),
    Object.freeze({ day: 2, revenue: 20, payroll: 8, profit: 12 }),
  ]);
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory });
  const snapshot = JSON.stringify(dailyHistory);

  render(<StatsPanel />);

  const list = screen.getByRole('list', { name: 'Recent daily finances' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('Day 2');
  expect(rows[0]).toHaveTextContent('Revenue: $20');
  expect(rows[1]).toHaveTextContent('Day 1');
  expect(JSON.stringify(dailyHistory)).toBe(snapshot);
  expect(dailyHistory.map(record => record.day)).toEqual([1, 2]);
});

it('rerenders completed-day finances for a changed immutable history', () => {
  const firstHistory = Object.freeze([
    Object.freeze({ day: 1, revenue: 100, payroll: 40, profit: 60 }),
  ]);
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory: firstHistory });
  const { rerender } = render(<StatsPanel />);

  let list = screen.getByRole('list', { name: 'Recent daily finances' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  expect(within(list).getByText('Day 1')).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: 1, revenue: 100, payroll: 40, profit: 60 },
      { day: 2, revenue: 250.5, payroll: 40, profit: 210.5 },
    ],
  });
  rerender(<StatsPanel />);

  list = screen.getByRole('list', { name: 'Recent daily finances' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Day 2');
  expect(rows[0]).toHaveTextContent('Revenue: $250.50');
  expect(rows[0]).toHaveTextContent('Profit: $210.50');
  expect(rows[1]).toHaveTextContent('Day 1');
});

it('associates the revenue chart with completed-day finances, including fractional and missing values', () => {
  const dailyHistory = Object.freeze([
    Object.freeze({ day: 4, revenue: 622.5, profit: -15.5 }),
    Object.freeze({
      day: 3, revenue: Number.POSITIVE_INFINITY, payroll: Number.NaN, profit: 10,
    }),
  ]);
  const snapshot = JSON.stringify(dailyHistory);
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory });
  render(<StatsPanel />);

  const chart = screen.getByRole('img', {
    name: 'Daily revenue for the last seven recorded days',
  });
  expect(chart.tagName).toBe('CANVAS');
  const describedBy = chart.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  const section = document.getElementById(describedBy);
  expect(section).toBe(screen.getByRole('region', { name: 'Completed-day finances' }));
  expect(within(section).getByText('Revenue: $622.50')).toBeInTheDocument();
  expect(within(section).getAllByText('Payroll: Unavailable')).toHaveLength(2);
  expect(within(section).getByText('Profit: $-15.50')).toBeInTheDocument();
  expect(chart).toHaveAccessibleDescription(
    /Day 3[\s\S]*Revenue: Unavailable[\s\S]*Day 4[\s\S]*Revenue: \$622\.50[\s\S]*Payroll: Unavailable[\s\S]*Profit: \$-15\.50/,
  );
  expect(chart.textContent).toBe('Revenue values are listed in Completed-day finances.');
  expect(JSON.stringify(dailyHistory)).toBe(snapshot);
});

it('names the empty revenue chart and references the empty completed-day text', () => {
  render(<StatsPanel />);

  const chart = screen.getByRole('img', { name: 'Daily revenue — no recorded days' });
  expect(chart.tagName).toBe('CANVAS');
  const describedBy = chart.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  const section = document.getElementById(describedBy);
  expect(section).toBe(screen.getByRole('region', { name: 'Completed-day finances' }));
  expect(within(section).getByText('No completed-day finances yet.')).toBeInTheDocument();
  expect(chart).toHaveAccessibleDescription(
    /Completed-day finances[\s\S]*No completed-day finances yet\./,
  );
  expect(chart.textContent).toBe('Revenue values are listed in Completed-day finances.');
});

it('describes only the latest seven completed days and leaves frozen history unchanged', () => {
  const dailyHistory = Object.freeze(Array.from({ length: 9 }, (_, index) => Object.freeze({
    day: index + 1,
    revenue: 100 + index,
    payroll: 50,
    profit: 50 + index,
  })));
  const snapshot = JSON.stringify(dailyHistory);
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory });
  render(<StatsPanel />);

  const chart = screen.getByRole('img', {
    name: 'Daily revenue for the last seven recorded days',
  });
  const section = document.getElementById(chart.getAttribute('aria-describedby'));
  expect(within(section).getAllByRole('listitem')).toHaveLength(7);
  expect(chart).toHaveAccessibleDescription(
    /Day 9[\s\S]*Revenue: \$108[\s\S]*Day 3[\s\S]*Revenue: \$102/,
  );
  expect(chart).not.toHaveAccessibleDescription(/Day 1\b/);
  expect(chart).not.toHaveAccessibleDescription(/Day 2\b/);
  expect(JSON.stringify(dailyHistory)).toBe(snapshot);
});

it('updates the chart name and description when completed history changes on rerender', () => {
  const { rerender } = render(<StatsPanel />);
  let chart = screen.getByRole('img', { name: 'Daily revenue — no recorded days' });
  const descriptionId = chart.getAttribute('aria-describedby');

  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 2, revenue: 250.5, payroll: 40, profit: 210.5 }],
  });
  rerender(<StatsPanel />);

  chart = screen.getByRole('img', {
    name: 'Daily revenue for the last seven recorded days',
  });
  expect(chart).toHaveAttribute('aria-describedby', descriptionId);
  expect(chart).toHaveAccessibleDescription(/Day 2[\s\S]*Revenue: \$250\.50/);

  mockUseGameState.mockReturnValue(baseState);
  rerender(<StatsPanel />);

  chart = screen.getByRole('img', { name: 'Daily revenue — no recorded days' });
  expect(chart).toHaveAttribute('aria-describedby', descriptionId);
  expect(chart).toHaveAccessibleDescription(/No completed-day finances yet\./);
});

it('gives simultaneously mounted revenue charts unique completed-finances description IDs', () => {
  render(
    <>
      <div data-testid="stats-one"><StatsPanel /></div>
      <div data-testid="stats-two"><StatsPanel /></div>
    </>,
  );

  const first = screen.getByTestId('stats-one');
  const second = screen.getByTestId('stats-two');
  const firstChart = within(first).getByRole('img', {
    name: 'Daily revenue — no recorded days',
  });
  const secondChart = within(second).getByRole('img', {
    name: 'Daily revenue — no recorded days',
  });
  const firstId = firstChart.getAttribute('aria-describedby');
  const secondId = secondChart.getAttribute('aria-describedby');

  expect(firstId).toBeTruthy();
  expect(secondId).toBeTruthy();
  expect(firstId).not.toBe(secondId);
  expect(within(first).getByRole('region', { name: 'Completed-day finances' }))
    .toHaveAttribute('id', firstId);
  expect(within(second).getByRole('region', { name: 'Completed-day finances' }))
    .toHaveAttribute('id', secondId);
});

it('shows a recent finance summary for the same seven completed records and rerenders without dispatching', () => {
  const dailyHistory = [
    { day: 1, revenue: 1000, payroll: 100, profit: 900 },
    { day: 2, revenue: 100, payroll: 20, profit: 80 },
    { day: 2, revenue: 0, payroll: 'missing', profit: 0 },
    { day: 9, revenue: -5, payroll: 5, profit: -10 },
    { day: 20, revenue: '25', payroll: 30 },
    { day: 20, revenue: Number.NaN, payroll: 20, profit: 20 },
    { day: 42, revenue: 25, payroll: Number.POSITIVE_INFINITY, profit: 25 },
    { day: 42, payroll: 5, profit: -1 },
  ];
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 777.25 },
    dailyHistory,
    staff: [{ id: 's1', salary: 150.25 }],
  });
  const { rerender } = render(<StatsPanel />);

  const completed = screen.getByRole('region', { name: 'Completed-day finances' });
  const summary = within(completed).getByRole('region', { name: 'Recent finance summary' });
  expect(within(summary).getByText('Revenue total: $120 (4 of 7 records)')).toBeInTheDocument();
  expect(within(summary).getByText('Payroll total: $80 (5 of 7 records)')).toBeInTheDocument();
  expect(within(summary).getByText('Revenue minus payroll total: $114 (6 of 7 records)'))
    .toBeInTheDocument();
  expect(within(summary).getByText('Average recorded revenue minus payroll: $19 (6 of 7 records)'))
    .toBeInTheDocument();
  expect(within(summary).getByText('Positive revenue-minus-payroll records: 3 of 6'))
    .toBeInTheDocument();
  expect(summary).not.toHaveTextContent('777.25');
  expect(summary).not.toHaveTextContent('$900');

  const list = within(completed).getByRole('list', { name: 'Recent daily finances' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(7);
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Day 42');
  expect(within(list).queryByText('Day 1')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Daily revenue for the last seven recorded days' }))
    .toBeInTheDocument();
  expect(mockUseDispatch).not.toHaveBeenCalled();

  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 43, revenue: 20, payroll: 5, profit: 15 }],
  });
  rerender(<StatsPanel />);

  const updated = within(screen.getByRole('region', { name: 'Completed-day finances' }))
    .getByRole('region', { name: 'Recent finance summary' });
  expect(within(updated).getByText('Revenue total: $20 (1 of 1 records)')).toBeInTheDocument();
  expect(within(updated).queryByText('Revenue total: $120 (4 of 7 records)'))
    .not.toBeInTheDocument();
  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it('does not infer missing stored profit and formats aggregate overflow as unavailable', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: 1, revenue: Number.MAX_VALUE, payroll: Number.MAX_VALUE },
      { day: 2, revenue: Number.MAX_VALUE, payroll: Number.MAX_VALUE, profit: '0' },
    ],
  });
  render(<StatsPanel />);

  const summary = within(screen.getByRole('region', { name: 'Completed-day finances' }))
    .getByRole('region', { name: 'Recent finance summary' });
  expect(within(summary).getByText('Revenue total: Unavailable (2 of 2 records)'))
    .toBeInTheDocument();
  expect(within(summary).getByText('Payroll total: Unavailable (2 of 2 records)'))
    .toBeInTheDocument();
  expect(within(summary).getByText('Revenue minus payroll total: Unavailable (0 of 2 records)'))
    .toBeInTheDocument();
  expect(within(summary).getByText('Average recorded revenue minus payroll: Unavailable (0 of 2 records)'))
    .toBeInTheDocument();
  expect(within(summary).getByText(
    'Positive revenue-minus-payroll records: Unavailable (0 of 0 recorded profit values)',
  )).toBeInTheDocument();
  expect(within(summary).queryByText(/Revenue minus payroll total: \$0/))
    .not.toBeInTheDocument();
});

function dirtState(messCount, overrides = {}) {
  return {
    ...baseState,
    floorDirt: Array.from({ length: messCount }, (_, index) => ({
      id: `dirt-${index + 1}`, x: 700 + index * 20, y: 700,
    })),
    ...overrides,
  };
}

it('shows the cleanliness section with zero messes and pressure by default', () => {
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByRole('heading', { name: 'Cleanliness' })).toBeInTheDocument();
  expect(within(section).getByText('Floor messes: 0')).toBeInTheDocument();
  expect(within(section).getByText('Dirt-only reputation pressure: 0 per game minute.')).toBeInTheDocument();
  expect(DIRT_REPUTATION_THRESHOLD).toBe(3);
  expect(within(section).getByText(
    `Reputation pressure starts above ${DIRT_REPUTATION_THRESHOLD} floor messes. `
    + 'Nearby dirt can lower guest happiness even below this threshold. '
    + 'This is the dirt-only rate before the minimum rating and other reputation changes, not a net forecast.',
  )).toBeInTheDocument();
});

it('treats an empty floor-dirt list as zero messes', () => {
  mockUseGameState.mockReturnValue({ ...baseState, floorDirt: [] });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByText('Floor messes: 0')).toBeInTheDocument();
  expect(within(section).getByText('Dirt-only reputation pressure: 0 per game minute.')).toBeInTheDocument();
});

it.each([
  [0, '0'],
  [1, '0'],
  [3, '0'],
  [4, '-0.001'],
  [13, '-0.010'],
  [20, '-0.010'],
])('shows %s floor messes at pressure %s per game minute', (messCount, expected) => {
  mockUseGameState.mockReturnValue(dirtState(messCount));
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByText(`Floor messes: ${messCount}`)).toBeInTheDocument();
  expect(within(section).getByText(`Dirt-only reputation pressure: ${expected} per game minute.`))
    .toBeInTheDocument();
});

it('rerenders cleanliness pressure after an immutable floor-dirt change', () => {
  mockUseGameState.mockReturnValue(dirtState(3));
  const { rerender } = render(<StatsPanel />);

  let section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByText('Floor messes: 3')).toBeInTheDocument();
  expect(within(section).getByText('Dirt-only reputation pressure: 0 per game minute.')).toBeInTheDocument();

  mockUseGameState.mockReturnValue(dirtState(4));
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByText('Floor messes: 4')).toBeInTheDocument();
  expect(within(section).getByText('Dirt-only reputation pressure: -0.001 per game minute.')).toBeInTheDocument();
  expect(within(section).queryByText('Dirt-only reputation pressure: 0 per game minute.')).not.toBeInTheDocument();
});

it('keeps the formula pressure and caveat at the minimum reputation', () => {
  mockUseGameState.mockReturnValue(dirtState(4, {
    restaurant: { ...baseState.restaurant, reputation: 1 },
  }));
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByText('Dirt-only reputation pressure: -0.001 per game minute.')).toBeInTheDocument();
  expect(within(section).getByText(/not a net forecast\./)).toBeInTheDocument();
});

it('does not mutate a frozen floor-dirt list while rendering', () => {
  const floorDirt = Object.freeze([
    Object.freeze({ id: 'dirt-1', x: 700, y: 700 }),
    Object.freeze({ id: 'dirt-2', x: 720, y: 700 }),
    Object.freeze({ id: 'dirt-3', x: 740, y: 700 }),
    Object.freeze({ id: 'dirt-4', x: 760, y: 700 }),
  ]);
  const snapshot = JSON.stringify(floorDirt);
  mockUseGameState.mockReturnValue({ ...baseState, floorDirt });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Cleanliness' });
  expect(within(section).getByText('Floor messes: 4')).toBeInTheDocument();
  expect(JSON.stringify(floorDirt)).toBe(snapshot);
  expect(floorDirt.map(dirt => dirt.id)).toEqual(['dirt-1', 'dirt-2', 'dirt-3', 'dirt-4']);
});

it('shows the pending-food timing section with no recorded candidates', () => {
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByRole('heading', { name: 'Pending-food timing' })).toBeInTheDocument();
  expect(within(section).getByText('No recorded pending food orders.')).toBeInTheDocument();
  expect(within(section).queryByText(/Known timers:/)).not.toBeInTheDocument();
  expect(within(section).getByText(PENDING_FOOD_CAVEAT)).toBeInTheDocument();
});

it('shows ordered-dish blockers as overlapping structural counts and updates immutably', () => {
  const { rerender } = render(<StatsPanel />);
  let section = screen.getByRole('region', { name: 'Ordered-dish blockers' });
  expect(within(section).getByText('Eligible ordered dishes with no employed cook: 0'))
    .toBeInTheDocument();
  expect(within(section).getByText('Eligible ordered dishes with no compatible station: 0'))
    .toBeInTheDocument();
  expect(within(section).queryByRole('list', { name: 'Blocked dishes' })).not.toBeInTheDocument();

  const authored = withOwnedAuthoredDishes({
    ...baseState,
    customers: [{ id: 'customer-1', state: 'waiting_for_items', dishId: 'toast',
      menuOutcome: 'ordered', foodOutcome: 'pending' }],
    serviceItems: [],
    dishes: [{ id: 'toast', cookbookId: 'toast', price: 12, quality: 1 }],
    staff: [],
    kitchenStations: [],
  });
  const snapshot = createDishOrderSnapshot(getResolvedDish(authored, 'toast'), {
    serviceItemId: 'item-1', orderedAt: 0,
  });
  mockUseGameState.mockReturnValue({
    ...authored,
    customers: [{ ...authored.customers[0], dishOrderSnapshot: { ...snapshot } }],
    serviceItems: [{ id: 'item-1', customerId: 'customer-1', kind: 'dish', menuItemId: 'toast',
      state: 'ordered', assignedStaffId: null, dishOrderSnapshot: snapshot }],
  });
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Ordered-dish blockers' });
  expect(within(section).getByText('Eligible ordered dishes with no employed cook: 1'))
    .toBeInTheDocument();
  expect(within(section).getByText('Eligible ordered dishes with no compatible station: 1'))
    .toBeInTheDocument();
  expect(within(section).getByText(/These are structural prerequisites only/))
    .toHaveTextContent(/may overlap/);
  expect(within(section).getByText(/not wait-time or ETA estimates/))
    .toHaveTextContent(/guarantees of order arrival or preparation/);
  const details = within(section).getByRole('list', { name: 'Blocked dishes' });
  expect(within(details).getByRole('listitem')).toHaveTextContent(
    'Toasted Bread (toast): no employed cook: 1; no compatible station: 1',
  );
  mockUseGameState.mockReturnValue(baseState);
  rerender(<StatsPanel />);
  expect(within(section).queryByRole('list', { name: 'Blocked dishes' })).not.toBeInTheDocument();
});

it('locates the raw earliest food table identity and updates it on rerender', () => {
  const onLocateTable = vi.fn();
  const pending = tableId => ({ id: 'guest', tableId, foodOutcome: 'pending',
    foodDeadlineAt: 120, foodPatienceBudget: 30 });
  const initial = { ...baseState, restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [pending(0)], tables: [{ id: '0', x: 100, y: 60 }] };
  mockUseGameState.mockReturnValue(initial);
  const { rerender } = render(<StatsPanel onLocateTable={onLocateTable} />);
  fireEvent.click(screen.getByRole('button', { name: 'Locate table' }));
  expect(onLocateTable).toHaveBeenLastCalledWith(0);
  mockUseGameState.mockReturnValue({ ...initial, customers: [pending('next')],
    tables: [{ id: 'next', x: 200, y: 80 }] });
  rerender(<StatsPanel onLocateTable={onLocateTable} />);
  fireEvent.click(screen.getByRole('button', { name: 'Locate table' }));
  expect(onLocateTable).toHaveBeenLastCalledWith('next');
  expect(initial.customers[0].tableId).toBe(0);
  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it.each(['callback', 'placement', 'career', 'missing table', 'ambiguous table', 'coordinates'])(
  'disables earliest table locating for %s', reason => {
    const onLocateTable = vi.fn();
    const tables = reason === 'missing table' ? []
      : reason === 'ambiguous table' ? [{ id: 0, x: 10, y: 10 }, { id: '0', x: 20, y: 20 }]
        : [{ id: 0, x: reason === 'coordinates' ? NaN : 100, y: 60 }];
    mockUseGameState.mockReturnValue({ ...baseState, tables,
      careerRun: reason === 'career' ? { needsDecision: true } : null,
      customers: [{ id: 'guest', tableId: 0, foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 30 }] });
    render(<StatsPanel onLocateTable={reason === 'callback' ? undefined : onLocateTable}
      locateDisabled={reason === 'placement'} locateMessage="Location blocked." />);
    const button = screen.getByRole('button', { name: 'Locate table' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onLocateTable).not.toHaveBeenCalled();
    expect(screen.getByText('Location blocked.')).toBeInTheDocument();
  },
);

it('does not substitute a later table when the earliest deadline has no table identity', () => {
  mockUseGameState.mockReturnValue({ ...baseState, tables: [{ id: 'later', x: 10, y: 10 }],
    customers: [
      { id: 'first', foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 30 },
      { id: 'second', tableId: 'later', foodOutcome: 'pending', foodDeadlineAt: 160, foodPatienceBudget: 30 },
    ] });
  render(<StatsPanel onLocateTable={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Locate table' })).not.toBeInTheDocument();
});

it('shows pending timer counts, the earliest known deadline and the unknown notice', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [
      {
        id: 'explicit-known', foodOutcome: 'pending', foodDeadlineAt: 160, foodPatienceBudget: 30,
      },
      { id: 'legacy-known', foodOutcome: null, foodDeadlineAt: 140, foodPatienceBudget: 20 },
      {
        id: 'explicit-unknown', foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null,
      },
      { id: 'legacy-invalid', foodOutcome: null, foodDeadlineAt: null, foodPatienceBudget: null },
      { id: 'delivered', foodOutcome: 'delivered', foodDeadlineAt: 120, foodPatienceBudget: 30 },
    ],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText('Known timers: 2. Unknown timers: 1.')).toBeInTheDocument();
  expect(within(section).getByText(
    'Earliest known food deadline: 40s (game time remaining).',
  )).toBeInTheDocument();
  expect(within(section).getByText('Other pending deadlines are unknown.')).toBeInTheDocument();
  expect(within(section).queryByText('Food timing unavailable.')).not.toBeInTheDocument();
  expect(within(section).queryByText('Deadline reached.')).not.toBeInTheDocument();
  expect(within(section).getByText(PENDING_FOOD_CAVEAT)).toBeInTheDocument();
});

it('lists pending food orders with their own time, food stage and table action', () => {
  const onLocateTable = vi.fn();
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [
      { id: 'guest-near', dishId: 'toast', tableId: 'table-near', foodOutcome: 'pending',
        foodDeadlineAt: 115, foodPatienceBudget: 30 },
      { id: 'guest-later', dishId: 'soup', tableId: 'table-later', foodOutcome: 'pending',
        foodDeadlineAt: 180, foodPatienceBudget: 30 },
      { id: 'guest-unknown', dishId: 'stew', tableId: 'table-unknown', foodOutcome: 'pending',
        foodDeadlineAt: null, foodPatienceBudget: null },
    ],
    tables: [
      { id: 'table-near', x: 100, y: 100 },
      { id: 'table-later', x: 200, y: 100 },
      { id: 'table-unknown', x: 300, y: 100 },
    ],
    serviceItems: [
      { id: 'near-item', customerId: 'guest-near', kind: 'dish', menuItemId: 'toast', state: 'ordered' },
      { id: 'later-item', customerId: 'guest-later', kind: 'dish', menuItemId: 'soup', state: 'carried' },
      { id: 'unknown-drink', customerId: 'guest-unknown', kind: 'drink', menuItemId: 'water', state: 'ready' },
    ],
  });
  render(<StatsPanel onLocateTable={onLocateTable} />);

  const list = screen.getByRole('list', { name: 'Pending food orders' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent('Guest guest-near · Dish toast · Table table-near');
  expect(rows[0]).toHaveTextContent('15s (game time remaining)');
  expect(rows[0]).toHaveTextContent('Food-service stage: Awaiting preparation');
  expect(rows[1]).toHaveTextContent('Guest guest-later · Dish soup · Table table-later');
  expect(rows[1]).toHaveTextContent('1m 20s (game time remaining)');
  expect(rows[1]).toHaveTextContent('Food-service stage: Being carried');
  expect(rows[2]).toHaveTextContent('Timing unavailable');
  expect(rows[2]).toHaveTextContent('Food-service stage unavailable');
  expect(within(rows[2]).queryByText(/Ready for collection/)).not.toBeInTheDocument();

  const laterLocate = within(rows[1]).getByRole('button', {
    name: 'Locate table for guest guest-later at table table-later',
  });
  expect(laterLocate).toHaveStyle({
    maxWidth: '100%', whiteSpace: 'normal', overflowWrap: 'anywhere',
  });
  fireEvent.click(laterLocate);
  expect(onLocateTable).toHaveBeenCalledTimes(1);
  expect(onLocateTable).toHaveBeenLastCalledWith('table-later');
  expect(mockUseDispatch).not.toHaveBeenCalled();
  expect(within(screen.getByRole('region', { name: 'Pending-food timing' }))
    .getByRole('button', { name: 'Locate table' })).toBeInTheDocument();
});

it('shows known-deadline-first ordering guidance and the omitted-order count', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `guest-${index + 1}`, foodOutcome: 'pending',
        foodDeadlineAt: 110 + index, foodPatienceBudget: 30,
      })),
      { id: 'unknown', foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null },
    ],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  const list = within(section).getByRole('list', { name: 'Pending food orders' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Guest guest-1');
  expect(within(list).queryByText(/Guest unknown/)).not.toBeInTheDocument();
  expect(within(section).getByText('2 pending food orders omitted.')).toBeInTheDocument();
  expect(within(section).getByText(
    'Known deadlines are listed first; an unknown deadline is not a lower-urgency claim. '
      + 'Food-service stages are food-only and are not a delivery ETA.',
  )).toBeInTheDocument();
});

it.each(['missing callback', 'placement disabled', 'career decision', 'missing table',
  'duplicate table', 'invalid coordinates'])(
  'does not allow pending-food row navigation with %s', reason => {
    const onLocateTable = vi.fn();
    const tables = reason === 'missing table' ? []
      : reason === 'duplicate table'
        ? [{ id: 'target', x: 100, y: 100 }, { id: 'target', x: 200, y: 200 }]
        : [{ id: 'target', x: reason === 'invalid coordinates' ? Number.NaN : 100, y: 100 }];
    mockUseGameState.mockReturnValue({
      ...baseState,
      restaurant: { ...baseState.restaurant, gameTime: 100 },
      careerRun: reason === 'career decision' ? { needsDecision: true } : null,
      customers: [{ id: 'guest', dishId: 'toast', tableId: 'target', foodOutcome: 'pending',
        foodDeadlineAt: 120, foodPatienceBudget: 30 }],
      tables,
      serviceItems: [{ id: 'item', customerId: 'guest', kind: 'dish', menuItemId: 'toast', state: 'ready' }],
    });
    render(<StatsPanel
      onLocateTable={reason === 'missing callback' ? undefined : onLocateTable}
      locateDisabled={reason === 'placement disabled'}
    />);

    const list = screen.getByRole('list', { name: 'Pending food orders' });
    const button = within(within(list).getByRole('listitem')).getByRole('button', {
      name: 'Locate table for guest guest at table target',
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onLocateTable).not.toHaveBeenCalled();
  },
);

it('rechecks table coordinates on click and updates stages and delivered outcomes on rerender', () => {
  const onLocateTable = vi.fn();
  const table = { id: 'target', x: 100, y: 100 };
  const initial = {
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [{ id: 'guest', dishId: 'toast', tableId: 'target', foodOutcome: 'pending',
      foodDeadlineAt: 130, foodPatienceBudget: 30 }],
    tables: [table],
    serviceItems: [{ id: 'item', customerId: 'guest', kind: 'dish', menuItemId: 'toast', state: 'ordered' }],
  };
  mockUseGameState.mockReturnValue(initial);
  const { rerender } = render(<StatsPanel onLocateTable={onLocateTable} />);

  let list = screen.getByRole('list', { name: 'Pending food orders' });
  let row = within(list).getByRole('listitem');
  expect(row).toHaveTextContent('Food-service stage: Awaiting preparation');
  const locate = within(row).getByRole('button', {
    name: 'Locate table for guest guest at table target',
  });
  table.x = Number.NaN;
  fireEvent.click(locate);
  expect(onLocateTable).not.toHaveBeenCalled();

  mockUseGameState.mockReturnValue({
    ...initial,
    tables: [{ id: 'target', x: 100, y: 100 }],
    serviceItems: [{ ...initial.serviceItems[0], state: 'carried' }],
  });
  rerender(<StatsPanel onLocateTable={onLocateTable} />);
  list = screen.getByRole('list', { name: 'Pending food orders' });
  row = within(list).getByRole('listitem');
  expect(row).toHaveTextContent('Food-service stage: Being carried');

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [{ ...initial.customers[0], foodOutcome: 'delivered' }],
    tables: [{ id: 'target', x: 100, y: 100 }],
    serviceItems: [{ ...initial.serviceItems[0], state: 'delivered' }],
  });
  rerender(<StatsPanel onLocateTable={onLocateTable} />);
  expect(screen.queryByRole('list', { name: 'Pending food orders' })).not.toBeInTheDocument();
  expect(screen.getByText('No recorded pending food orders.')).toBeInTheDocument();
});

it('shows and immutably updates the recorded identity of the earliest known food target', () => {
  const firstCustomers = Object.freeze([
    Object.freeze({
      id: 'later-guest', dishId: 'later-dish', tableId: 'later-table',
      foodOutcome: 'pending', foodDeadlineAt: 160, foodPatienceBudget: 30,
    }),
    Object.freeze({
      id: 'guest', dishId: 'dish', tableId: 'table',
      foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 30,
    }),
  ]);
  const snapshot = JSON.stringify(firstCustomers);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: firstCustomers,
  });
  const { rerender } = render(<StatsPanel />);

  let section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food target: Guest guest · Dish dish · Table table.',
  )).toBeInTheDocument();

  const nextCustomers = Object.freeze([
    Object.freeze({
      id: 'next-guest', dishId: 'next-dish', tableId: 'next-table',
      foodOutcome: 'pending', foodDeadlineAt: 115, foodPatienceBudget: 30,
    }),
  ]);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: nextCustomers,
  });
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food target: Guest next-guest · Dish next-dish · Table next-table.',
  )).toBeInTheDocument();
  expect(within(section).queryByText(
    'Earliest known food target: Guest guest · Dish dish · Table table.',
  )).not.toBeInTheDocument();
  expect(JSON.stringify(firstCustomers)).toBe(snapshot);
});

it('shows an unavailable food target when all selected identity fields are invalid', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [{
      id: {}, dishId: Number.NaN, tableId: false,
      foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 30,
    }],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText('Earliest known food target: Unavailable.'))
    .toBeInTheDocument();
});

it('shows an unavailable food target when all recorded identity strings are blank', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [{
      id: ' \t ', dishId: '', tableId: '\n',
      foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 30,
    }],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText('Earliest known food target: Unavailable.'))
    .toBeInTheDocument();
});

it('shows food timing unavailable for an invalid game time while retaining the counts', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: Number.NaN },
    customers: [
      { id: 'known', foodOutcome: 'pending', foodDeadlineAt: 160, foodPatienceBudget: 30 },
      {
        id: 'unknown', foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null,
      },
    ],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText('Known timers: 1. Unknown timers: 1.')).toBeInTheDocument();
  expect(within(section).getByText('Food timing unavailable.')).toBeInTheDocument();
  expect(within(section).queryByText(/Earliest known food deadline:/)).not.toBeInTheDocument();
  expect(within(section).getByText('Other pending deadlines are unknown.')).toBeInTheDocument();
});

it('shows food timing unavailable when no candidate has a valid timer', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [
      {
        id: 'unknown', foodOutcome: 'pending', foodDeadlineAt: null, foodPatienceBudget: null,
      },
    ],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText('Known timers: 0. Unknown timers: 1.')).toBeInTheDocument();
  expect(within(section).getByText('Food timing unavailable.')).toBeInTheDocument();
  expect(within(section).getByText('Other pending deadlines are unknown.')).toBeInTheDocument();
  expect(within(section).getByText(PENDING_FOOD_CAVEAT)).toBeInTheDocument();
});

it('shows zero remaining time and Deadline reached exactly at and after the deadline', () => {
  const customers = [
    { id: 'known', foodOutcome: 'pending', foodDeadlineAt: 120, foodPatienceBudget: 30 },
  ];
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 120 },
    customers,
  });
  const { rerender } = render(<StatsPanel />);

  let section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food deadline: 0s (game time remaining).',
  )).toBeInTheDocument();
  expect(within(section).getByText('Deadline reached.')).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 240 },
    customers,
  });
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food deadline: 0s (game time remaining).',
  )).toBeInTheDocument();
  expect(within(section).getByText('Deadline reached.')).toBeInTheDocument();
});

it('keeps pending-food timing independent of closed and pause flags', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: {
      ...baseState.restaurant,
      gameTime: 20 * 3600,
      openHour: 9,
      closeHour: 17,
      walkInsPaused: true,
    },
    customers: [
      { id: 'known', foodOutcome: 'pending', foodDeadlineAt: 20 * 3600 + 30, foodPatienceBudget: 30 },
    ],
  });
  render(<StatsPanel />);

  const section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food deadline: 30s (game time remaining).',
  )).toBeInTheDocument();
  expect(within(section).queryByText('Food timing unavailable.')).not.toBeInTheDocument();
});

it('rerenders pending-food timing immutably and leaves the existing queue unchanged', () => {
  const firstCustomers = Object.freeze([
    Object.freeze({
      id: 'known', foodOutcome: 'pending', foodDeadlineAt: 130, foodPatienceBudget: 30,
    }),
  ]);
  const snapshot = JSON.stringify(firstCustomers);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: firstCustomers,
    queue: [{ partyId: 'p1', members: [queuedMember(10, 20)] }],
  });
  const { rerender } = render(<StatsPanel />);

  let section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food deadline: 30s (game time remaining).',
  )).toBeInTheDocument();
  let queue = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(queue).getByText('Party 1: 1 guest')).toBeInTheDocument();
  expect(within(queue).getByText('Lowest-remaining guest: 50% patience')).toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, gameTime: 100 },
    customers: [
      { id: 'known', foodOutcome: 'pending', foodDeadlineAt: 150, foodPatienceBudget: 30 },
    ],
    queue: [{ partyId: 'p1', members: [queuedMember(10, 20)] }],
  });
  rerender(<StatsPanel />);

  section = screen.getByRole('region', { name: 'Pending-food timing' });
  expect(within(section).getByText(
    'Earliest known food deadline: 50s (game time remaining).',
  )).toBeInTheDocument();
  expect(within(section).queryByText(
    'Earliest known food deadline: 30s (game time remaining).',
  )).not.toBeInTheDocument();
  queue = screen.getByRole('list', { name: 'Queue patience' });
  expect(within(queue).getByText('Party 1: 1 guest')).toBeInTheDocument();
  expect(JSON.stringify(firstCustomers)).toBe(snapshot);
  expect(firstCustomers[0].foodDeadlineAt).toBe(130);
});

it('records signed revenue as a grey baseline, gold bars and chronological day labels', () => {
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: 1, revenue: 100 },
      { day: 2, revenue: -50 },
      { day: 3, revenue: 0 },
      { day: 4, revenue: null },
      { day: 5, revenue: Number.POSITIVE_INFINITY },
    ],
  });
  render(<StatsPanel />);

  const canvas = document.querySelector('canvas');
  expect(canvas.width).toBe(300);
  expect(canvas.height).toBe(120);
  expect(screen.getByText(REVENUE_CHART_CAPTION)).toBeInTheDocument();

  expect(calls.rects).toHaveLength(3);
  const [baseline, positive, negative] = calls.rects;
  expect(baseline).toMatchObject({
    x: 0, width: 300, height: 1, fillStyle: '#888',
  });
  expect(baseline.y).toBeCloseTo(200 / 3, 10);
  expect(positive).toMatchObject({ x: 2, width: 56, fillStyle: '#f0a500' });
  expect(positive.y).toBeCloseTo(0, 10);
  expect(positive.height).toBeCloseTo(200 / 3, 10);
  expect(negative).toMatchObject({ x: 62, width: 56, fillStyle: '#f0a500' });
  expect(negative.y).toBeCloseTo(200 / 3, 10);
  expect(negative.height).toBeCloseTo(100 / 3, 10);

  expect(calls.texts.map(call => call.text)).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
  expect(calls.texts.map(call => call.x)).toEqual([2, 62, 122, 182, 242]);
  expect(calls.texts.every(call => call.y === 118)).toBe(true);
  expect(calls.texts.every(call => call.fillStyle === '#888')).toBe(true);
  expect(calls.texts.every(call => call.font === getCanvasFont('compact'))).toBe(true);

  for (const rect of calls.rects) {
    for (const value of [rect.x, rect.y, rect.width, rect.height]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
  }
  for (const text of calls.texts) {
    expect(text.text).toMatch(/^D(?:\d+|-?\d+(?:\.\d+)?|\?)$/);
    expect(Number.isFinite(text.x)).toBe(true);
    expect(Number.isFinite(text.y)).toBe(true);
  }
});

it('draws no plot for empty or missing history', () => {
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory: [] });
  const { rerender } = render(<StatsPanel />);

  expect(calls.rects).toHaveLength(0);
  expect(calls.texts).toHaveLength(0);
  expect(screen.getByText(REVENUE_CHART_CAPTION)).toBeInTheDocument();

  const withoutHistory = { ...baseState };
  delete withoutHistory.dailyHistory;
  mockUseGameState.mockReturnValue(withoutHistory);
  rerender(<StatsPanel />);

  expect(calls.rects).toHaveLength(0);
  expect(calls.texts).toHaveLength(0);
});

it('skips canvas drawing safely when the 2d context becomes unavailable on rerender', () => {
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 10 }],
  });
  const { rerender } = render(<StatsPanel />);

  expect(calls.rects).toHaveLength(2);
  expect(calls.texts).toHaveLength(1);

  const nullContext = vi.fn(() => null);
  HTMLCanvasElement.prototype.getContext = nullContext;
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 2, revenue: 20 }],
  });
  expect(() => rerender(<StatsPanel />)).not.toThrow();

  expect(nullContext).toHaveBeenCalled();
  expect(calls.rects).toHaveLength(2);
  expect(calls.texts).toHaveLength(1);
});

function installResizeObserverMock() {
  const observers = [];
  class ResizeObserverMock {
    constructor(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      observers.push(this);
    }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  return observers;
}

it('updates the backing canvas size from CSS dimensions when ResizeObserver fires', () => {
  const observers = installResizeObserverMock();
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  render(<StatsPanel />);

  const canvas = document.querySelector('canvas');
  expect(observers).toHaveLength(1);
  expect(observers[0].observe).toHaveBeenCalledWith(canvas);
  expect(canvas.width).toBe(300);

  canvasClientWidth = 425;
  observers[0].callback([{ target: canvas }], observers[0]);

  expect(canvas.width).toBe(425);
  expect(calls.rects.at(-2)).toMatchObject({ x: 0, width: 425, height: 1 });
});

it('scales backing dimensions for DPR 2 while drawing with CSS-pixel geometry', () => {
  devicePixelRatio = 2;
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  render(<StatsPanel />);

  const canvas = document.querySelector('canvas');
  expect(canvas.width).toBe(600);
  expect(canvas.height).toBe(240);
  expect(calls.transforms).toEqual([[2, 0, 0, 2, 0, 0]]);
  expect(calls.rects[0]).toMatchObject({ x: 0, width: 300, height: 1 });
  expect(calls.texts[0]).toMatchObject({ text: 'D1', x: 2, y: 118 });
});

it('rounds fractional-DPR backing dimensions without changing CSS chart geometry', () => {
  canvasClientWidth = 301;
  canvasClientHeight = 121;
  devicePixelRatio = 1.5;
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  render(<StatsPanel />);

  const canvas = document.querySelector('canvas');
  expect(canvas.width).toBe(452);
  expect(canvas.height).toBe(182);
  expect(calls.transforms).toEqual([[1.5, 0, 0, 1.5, 0, 0]]);
  expect(calls.rects[0]).toMatchObject({ x: 0, width: 301, height: 1 });
  expect(calls.texts[0]).toMatchObject({ text: 'D1', x: 2, y: 119 });
});

it.each([0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
  'uses DPR 1 when devicePixelRatio is not a positive finite number (%s)', dpr => {
    devicePixelRatio = dpr;
    const { ctx, calls } = createRecordingContext();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
    mockUseGameState.mockReturnValue({
      ...baseState,
      dailyHistory: [{ day: 1, revenue: 100 }],
    });
    render(<StatsPanel />);

    const canvas = document.querySelector('canvas');
    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(120);
    expect(calls.transforms).toEqual([[1, 0, 0, 1, 0, 0]]);
  },
);

it('clears old pixels when history becomes empty', () => {
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  const { rerender } = render(<StatsPanel />);
  expect(calls.rects).toHaveLength(2);

  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory: [] });
  rerender(<StatsPanel />);

  expect(calls.clears).toHaveLength(2);
  expect(calls.clears.at(-1)).toEqual({ x: 0, y: 0, width: 300, height: 120 });
  expect(calls.rects).toHaveLength(2);
  expect(calls.texts).toHaveLength(1);
});

it('resets the transform on every redraw instead of accumulating DPR scaling', () => {
  devicePixelRatio = 2;
  const observers = installResizeObserverMock();
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  render(<StatsPanel />);

  observers[0].callback([], observers[0]);
  observers[0].callback([], observers[0]);

  expect(calls.transforms).toEqual([
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 2, 0, 0],
    [2, 0, 0, 2, 0, 0],
  ]);
});

it('cleans up ResizeObserver and window resize subscriptions on unmount', () => {
  const observers = installResizeObserverMock();
  const addEventListener = vi.spyOn(window, 'addEventListener');
  const removeEventListener = vi.spyOn(window, 'removeEventListener');
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  const { unmount } = render(<StatsPanel />);
  const resizeRegistration = addEventListener.mock.calls.find(([type]) => type === 'resize');
  expect(resizeRegistration).toBeDefined();
  const resizeHandler = resizeRegistration[1];

  unmount();

  expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
  expect(removeEventListener).toHaveBeenCalledWith('resize', resizeHandler);
});

it('redraws on window resize when ResizeObserver is unavailable', () => {
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 1, revenue: 100 }],
  });
  render(<StatsPanel />);

  const canvas = document.querySelector('canvas');
  canvasClientWidth = 480;
  window.dispatchEvent(new Event('resize'));

  expect(canvas.width).toBe(480);
  expect(calls.rects.at(-2)).toMatchObject({ x: 0, width: 480, height: 1 });
});

it('redraws for history changes but not for unrelated StatsPanel renders', () => {
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  const firstHistory = [{ day: 1, revenue: 100 }];
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory: firstHistory });
  const { rerender } = render(<StatsPanel />);
  const initialRectCount = calls.rects.length;

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: { ...baseState.restaurant, dailyRevenue: 50 },
    dailyHistory: firstHistory,
  });
  rerender(<StatsPanel />);
  expect(calls.rects).toHaveLength(initialRectCount);

  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [{ day: 2, revenue: 200 }],
  });
  rerender(<StatsPanel />);
  expect(calls.rects).toHaveLength(initialRectCount + 2);
  expect(calls.texts.at(-1).text).toBe('D2');
});

it('keeps resize subscriptions stable across equal fresh history and draws latest chart data', () => {
  const observers = installResizeObserverMock();
  const addEventListener = vi.spyOn(window, 'addEventListener');
  const { ctx, calls } = createRecordingContext();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx);
  const firstHistory = [
    { day: 1, revenue: 100, payroll: 40, profit: 60 },
    { day: 2, revenue: -50, payroll: 25, profit: -75 },
  ];
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory: firstHistory });
  const { rerender } = render(<StatsPanel />);
  const initialRectCount = calls.rects.length;
  const initialTextCount = calls.texts.length;

  const equivalentHistory = firstHistory.map(entry => ({ ...entry }));
  mockUseGameState.mockReturnValue({ ...baseState, dailyHistory: equivalentHistory });
  rerender(<StatsPanel />);

  expect(calls.rects).toHaveLength(initialRectCount);
  expect(calls.texts).toHaveLength(initialTextCount);
  expect(observers).toHaveLength(1);
  expect(observers[0].disconnect).not.toHaveBeenCalled();
  expect(observers[0].observe).toHaveBeenCalledTimes(1);
  expect(addEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);

  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: 1, revenue: 100, payroll: 45, profit: 55 },
      { day: 2, revenue: -50, payroll: 30, profit: -80 },
    ],
  });
  rerender(<StatsPanel />);

  expect(calls.rects).toHaveLength(initialRectCount);
  expect(calls.texts).toHaveLength(initialTextCount);
  expect(observers).toHaveLength(1);
  expect(observers[0].disconnect).not.toHaveBeenCalled();
  expect(addEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);

  mockUseGameState.mockReturnValue({
    ...baseState,
    dailyHistory: [
      { day: 1, revenue: 100, payroll: 45, profit: 55 },
      { day: 3, revenue: -25, payroll: 25, profit: -50 },
    ],
  });
  rerender(<StatsPanel />);

  expect(calls.rects).toHaveLength(initialRectCount + 3);
  expect(calls.texts).toHaveLength(initialTextCount + 2);
  expect(calls.texts.at(-1).text).toBe('D3');
  expect(observers).toHaveLength(1);
  expect(observers[0].disconnect).not.toHaveBeenCalled();
  expect(addEventListener.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);

  canvasClientWidth = 500;
  observers[0].callback([], observers[0]);
  expect(calls.texts.slice(-2).map(call => call.text)).toEqual(['D1', 'D3']);
});

const QUEUE_ADMISSION_CAVEAT = 'The limit counts parties, not guests. '
  + 'A full queue blocks new walk-ins and scheduled party admission; '
  + 'free slots do not guarantee an arrival or a seat.';

function queueParties(count, membersPerParty = 1) {
  return Array.from({ length: count }, (_, index) => ({
    partyId: `p${index + 1}`,
    members: Array.from({ length: membersPerParty }, (_, memberIndex) => queuedMember(100, 100, {
      id: `p${index + 1}-m${memberIndex + 1}`,
    })),
  }));
}

function serviceNowSection() {
  return screen.getByRole('region', { name: 'Service now' });
}

it('shows queue admission slots and remaining slots below capacity', () => {
  mockUseGameState.mockReturnValue({ ...baseState, queue: queueParties(2, 2) });
  render(<StatsPanel />);

  const section = serviceNowSection();
  expect(within(section).getByText('Entry queue: 2 parties · 4 guests')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission slots: 2 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 6')).toBeInTheDocument();
  expect(within(section).queryByText('Queue admission capacity reached.')).not.toBeInTheDocument();
  expect(within(section).getByText(QUEUE_ADMISSION_CAVEAT)).toBeInTheDocument();
  expect(section.querySelector('[aria-live], [role="status"]')).toBeNull();
  expect(mockUseDispatch).not.toHaveBeenCalled();
});

it('counts empty party records at exact capacity and shows zero remaining', () => {
  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [...queueParties(7), { partyId: 'empty', members: [] }],
  });
  render(<StatsPanel />);

  const section = serviceNowSection();
  expect(within(section).getByText('Entry queue: 7 parties · 7 guests')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission slots: 8 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 0')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission capacity reached.')).toBeInTheDocument();
  expect(within(section).getByText(QUEUE_ADMISSION_CAVEAT)).toBeInTheDocument();
});

it('clamps remaining slots at zero and keeps the reached notice above capacity', () => {
  mockUseGameState.mockReturnValue({ ...baseState, queue: queueParties(9) });
  render(<StatsPanel />);

  const section = serviceNowSection();
  expect(within(section).getByText('Entry queue: 9 parties · 9 guests')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission slots: 9 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 0')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission capacity reached.')).toBeInTheDocument();
});

it('counts canonical party records while leaving nonempty service counts unchanged', () => {
  const queue = [
    {
      partyId: 'multi',
      members: [
        queuedMember(100, 100, { id: 'multi-1' }),
        queuedMember(100, 100, { id: 'multi-2' }),
        queuedMember(100, 100, { id: 'multi-3' }),
      ],
    },
    { ...queuedMember(100, 100), id: 'legacy-1', partyId: 'legacy' },
    { ...queuedMember(100, 100), id: 'legacy-2', partyId: 'legacy' },
    { partyId: 'grouped', members: [queuedMember(100, 100, { id: 'grouped-1' })] },
    { partyId: 'grouped', members: [queuedMember(100, 100, { id: 'grouped-2' })] },
    { partyId: 'empty', members: [] },
  ];
  mockUseGameState.mockReturnValue({ ...baseState, queue });
  render(<StatsPanel />);

  const section = serviceNowSection();
  expect(within(section).getByText('Entry queue: 3 parties · 7 guests')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission slots: 4 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 4')).toBeInTheDocument();
  expect(within(section).queryByText('Queue admission capacity reached.')).not.toBeInTheDocument();
});

it('treats a missing queue as zero admission parties', () => {
  const withoutQueue = { ...baseState };
  delete withoutQueue.queue;
  mockUseGameState.mockReturnValue(withoutQueue);
  render(<StatsPanel />);

  const section = serviceNowSection();
  expect(within(section).getByText('Entry queue: 0 parties · 0 guests')).toBeInTheDocument();
  expect(within(section).getByText('Queue admission slots: 0 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 8')).toBeInTheDocument();
  expect(within(section).queryByText('Queue admission capacity reached.')).not.toBeInTheDocument();
  expect(within(section).getByText(QUEUE_ADMISSION_CAVEAT)).toBeInTheDocument();
});

it('keeps admission slots derived from frozen queue data across pause and open-state changes', () => {
  const frozenQueue = Object.freeze([
    Object.freeze({
      partyId: 'p1',
      members: Object.freeze([Object.freeze(queuedMember(10, 20, { id: 'p1-m1' }))]),
    }),
    Object.freeze({
      partyId: 'p2',
      members: Object.freeze([Object.freeze(queuedMember(25, 100, { id: 'p2-m1' }))]),
    }),
  ]);
  const snapshot = JSON.stringify(frozenQueue);
  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: {
      ...baseState.restaurant,
      gameTime: 20 * 3600,
      openHour: 9,
      closeHour: 17,
      walkInsPaused: true,
    },
    queue: frozenQueue,
  });
  const { rerender } = render(<StatsPanel />);

  let section = serviceNowSection();
  expect(within(section).getByText('Queue admission slots: 2 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 6')).toBeInTheDocument();
  expect(within(section).queryByText('Queue admission capacity reached.')).not.toBeInTheDocument();

  mockUseGameState.mockReturnValue({
    ...baseState,
    restaurant: {
      ...baseState.restaurant,
      gameTime: 10 * 3600,
      openHour: 9,
      closeHour: 17,
      walkInsPaused: false,
    },
    queue: frozenQueue,
  });
  rerender(<StatsPanel />);

  section = serviceNowSection();
  expect(within(section).getByText('Queue admission slots: 2 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 6')).toBeInTheDocument();
  expect(within(section).queryByText('Queue admission capacity reached.')).not.toBeInTheDocument();
  expect(JSON.stringify(frozenQueue)).toBe(snapshot);

  mockUseGameState.mockReturnValue({
    ...baseState,
    queue: [...frozenQueue, {
      partyId: 'p3',
      members: [queuedMember(100, 100, { id: 'p3-m1' })],
    }],
  });
  rerender(<StatsPanel />);

  section = serviceNowSection();
  expect(within(section).getByText('Queue admission slots: 3 / 8 parties')).toBeInTheDocument();
  expect(within(section).getByText('Remaining party slots: 5')).toBeInTheDocument();
  expect(JSON.stringify(frozenQueue)).toBe(snapshot);
});

describe('confirmed sandbox reset', () => {
  const EXACT_CONFIRMATION = 'Start a new sandbox? This replaces your current restaurant, any career and its local autosave. No backup is created. Cancel keeps this restaurant.';

  it('cancels without removing storage or dispatching', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    render(<StatsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(EXACT_CONFIRMATION);
    expect(requestNewSandboxMock).toHaveBeenCalledTimes(1);
    expect(requestNewSandboxMock).toHaveBeenCalledWith(mockUseDispatch);
    expect(removeItem).not.toHaveBeenCalled();
    expect(mockUseDispatch).not.toHaveBeenCalled();
  });

  it('confirms with the exact copy, removes the autosave and dispatches one fresh state', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    localStorage.setItem('restaurant-sim-save', JSON.stringify({ synthetic: true }));
    render(<StatsPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));

    expect(confirm).toHaveBeenCalledWith(EXACT_CONFIRMATION);
    expect(requestNewSandboxMock).toHaveBeenCalledWith(mockUseDispatch);
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith('restaurant-sim-save');
    expect(mockUseDispatch).toHaveBeenCalledTimes(1);
    expect(mockUseDispatch).toHaveBeenCalledWith({
      type: 'LOAD_STATE',
      state: expect.objectContaining({
        careerRun: null,
        restaurant: expect.objectContaining({ funds: 600, day: 1 }),
      }),
    });
  });

  it('does not reload the page when reset is requested', () => {
    const source = readFileSync('src/panels/StatsPanel.jsx', 'utf8');
    expect(source).not.toMatch(/location\.reload/);
  });
});
