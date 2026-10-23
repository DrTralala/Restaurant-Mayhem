import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FixtureSaleReview from './FixtureSaleReview';

const review = {
  requestedItems: [
    { type: 'table', id: 't1' },
    { type: 'washStation', id: 'auto' },
  ],
  entries: [
    { type: 'table', id: 't1', eligible: true, reason: null },
    { type: 'washStation', id: 'auto', eligible: false, reason: 'in-use' },
  ],
  eligibleItems: [{ type: 'table', id: 't1' }],
  expectedSale: {
    refund: 175,
    items: [{ type: 'chair', id: 'ch1' }, { type: 'table', id: 't1' }],
  },
  refund: 175,
  affectedChairIds: ['ch1'],
};

describe('FixtureSaleReview', () => {
  it('names a non-modal region and lists eligible and excluded facts', () => {
    render(<FixtureSaleReview review={review} notice=""
      onCancel={() => {}} onConfirm={() => {}} />);

    const region = screen.getByRole('region', { name: 'Review fixture sale' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(region).toHaveStyle({ position: 'absolute', overflow: 'auto' });
    expect(within(region).getByText('Table t1')).toBeInTheDocument();
    expect(within(region).getByText('Wash station auto — In use')).toBeInTheDocument();
    expect(within(region).getByText('Removes chairs ch1')).toBeInTheDocument();
    expect(within(region).getByText('Refund: $175')).toBeInTheDocument();
  });

  it('autofocuses Cancel and disables Confirm when nothing is eligible', () => {
    const nothingEligible = {
      ...review,
      entries: [review.entries[1]],
      eligibleItems: [],
      expectedSale: null,
      refund: null,
      affectedChairIds: [],
    };
    render(<FixtureSaleReview review={nothingEligible} notice=""
      onCancel={() => {}} onConfirm={() => {}} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(screen.queryByText(/^Refund:/)).not.toBeInTheDocument();
  });

  it('renders numeric ids and disables Confirm when no sale can be computed', () => {
    const numeric = {
      ...review,
      entries: [{ type: 'table', id: 7, eligible: true, reason: null }],
      eligibleItems: [{ type: 'table', id: 7 }],
      expectedSale: {
        refund: 175,
        items: [{ type: 'chair', id: '8' }, { type: 'table', id: '7' }],
      },
      refund: 175,
      affectedChairIds: ['8'],
    };
    const { rerender } = render(<FixtureSaleReview review={numeric} notice=""
      onCancel={() => {}} onConfirm={() => {}} />);

    expect(screen.getByText('Table 7')).toBeInTheDocument();
    expect(screen.getByText('Removes chairs 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled();

    rerender(<FixtureSaleReview review={{ ...numeric, expectedSale: null, refund: null }}
      notice="" onCancel={() => {}} onConfirm={() => {}} />);

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('shows the stale notice and delegates both actions', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<FixtureSaleReview review={review}
      notice="Sale details changed. Review them before confirming again."
      onCancel={onCancel} onConfirm={onConfirm} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Sale details changed. Review them before confirming again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
