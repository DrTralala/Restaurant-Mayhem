import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MenuModal from './MenuModal';

vi.mock('./MenuPanel', () => ({ default: () => <div>Menu panel</div> }));

describe('MenuModal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<MenuModal isOpen={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the menu panel while open', () => {
    render(<MenuModal isOpen onClose={vi.fn()} />);

    expect(screen.getByText('Menu panel')).toBeInTheDocument();
  });

  it('closes from the backdrop', () => {
    const onClose = vi.fn();
    const { container } = render(<MenuModal isOpen onClose={onClose} />);

    fireEvent.click(container.firstChild.firstChild);

    expect(onClose).toHaveBeenCalledOnce();
  });
});
