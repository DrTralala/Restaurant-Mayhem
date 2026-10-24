import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import StatsPanel from './StatsPanel';
import { DIRT_REPUTATION_THRESHOLD } from '../simulation/dirt';
import { getCanvasFont } from '../typography';

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
  const calls = { rects: [], texts: [] };
  const ctx = {
    fillStyle: '#000',
    font: '',
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
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 300,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 120,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect: vi.fn(),
    fillText: vi.fn(),
  }));
  mockUseGameState.mockReturnValue(baseState);
  mockUseDispatch.mockClear();
  requestNewSandboxMock.mockClear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

it('shows empty party review aggregates', () => {
  render(<StatsPanel />);
  expect(screen.getByText('Average party review: —')).toBeInTheDocument();
  expect(screen.getByText('Completed reviews: 0')).toBeInTheDocument();
});

it('shows aggregates and only the latest ten reviews newest first', () => {
  const scores = [-50, -5, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const partyReviewHistory = scores.map((score, index) => {
    const unaffordableCount = index % 3 === 0 ? 1 : 0;
    return {
      partyId: `p${index + 1}`,
      day: index + 1,
      score,
      memberCount: 2,
      paidCount: 2 - unaffordableCount,
      unaffordableCount,
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
  const rows = screen.getAllByTestId('party-review-row');
  expect(rows).toHaveLength(10);
  expect(rows[0]).toHaveTextContent('Day 12 · p12');
  expect(rows[0]).toHaveTextContent('Score: 90.0');
  expect(rows[0]).toHaveTextContent('Party: 2 · Paid: 2 · Unaffordable: 0');
  expect(rows[0]).toHaveTextContent('Reputation: +0.036');
  expect(rows.at(-1)).toHaveTextContent('Day 3 · p3');
  expect(screen.queryByText(/p1$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/p2$/)).not.toBeInTheDocument();
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
      unaffordableCount: 0, reputationDelta: 0.032,
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
  expect(within(section).getByText(
    'Last seven recorded days. Profit is revenue minus payroll, not total cash movement; '
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
