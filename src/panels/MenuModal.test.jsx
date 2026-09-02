import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MenuIcon from '../components/MenuIcon';
import MenuModal from './MenuModal';

vi.mock('./MenuPanel', () => ({ default: () => <div>Menu panel</div> }));

describe('MenuModal', () => {
  function MenuHarness() {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <MenuIcon onClick={() => setIsOpen(true)} isOpen={isOpen} />
        <MenuModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
      </>
    );
  }

  it('renders nothing while closed', () => {
    const { container } = render(<MenuModal isOpen={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the menu panel while open', () => {
    const onClose = vi.fn();
    render(<MenuModal isOpen onClose={onClose} />);

    expect(screen.getByText('Menu panel')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the backdrop', () => {
    const onClose = vi.fn();
    render(<MenuModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss menu' }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus inside, closes with Escape, and restores focus to the opener', () => {
    render(<MenuHarness />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();

    fireEvent.click(opener);

    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
