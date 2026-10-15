import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import StatsPanel from './StatsPanel';

const { mockUseGameState } = vi.hoisted(() => ({ mockUseGameState: vi.fn() }));
vi.mock('../state/GameContext', () => ({ useGameState: () => mockUseGameState() }));

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
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({}));
  mockUseGameState.mockReturnValue(baseState);
});

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
  expect(screen.getByText("All queued parties are included, even those not shown outside. "
    + "A party leaves when any guest runs out of queue patience. Percentages show the "
    + "lowest-remaining guest's share of their own maximum, not a countdown or comparable "
    + 'departure time.')).toBeInTheDocument();
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
