import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MenuIcon from '../components/MenuIcon';
import MenuModal from './MenuModal';
import { createInitialState } from '../state/initialState';

const { dispatch, gameState } = vi.hoisted(() => ({
  dispatch: vi.fn(),
  gameState: { current: null },
}));
vi.mock('../state/GameContext', () => ({
  useGameState: () => gameState.current,
  useDispatch: () => dispatch,
}));

describe('MenuModal', () => {
  function MenuHarness({ onClose = () => {} }) {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <MenuIcon onClick={() => setIsOpen(true)} isOpen={isOpen} />
        <button type="button">Outside menu</button>
        <MenuModal
          isOpen={isOpen}
          onClose={() => {
            onClose();
            setIsOpen(false);
          }}
        />
      </>
    );
  }

  beforeEach(() => {
    dispatch.mockClear();
    gameState.current = createInitialState();
  });

  it('renders nothing while closed', () => {
    const { container } = render(<MenuModal isOpen={false} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders the menu panel while open', () => {
    const onClose = vi.fn();
    render(<MenuModal isOpen onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'Menu' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('heading', { name: 'Menu' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Toasted Bread menu item' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the backdrop, which is not a tab destination', () => {
    const onClose = vi.fn();
    render(<MenuModal isOpen onClose={onClose} />);

    const backdrop = screen.getByRole('button', { name: 'Dismiss menu' });
    expect(backdrop).toHaveAttribute('tabindex', '-1');
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus inside, closes with Escape, and restores focus to the opener', () => {
    render(<MenuHarness />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();

    fireEvent.click(opener);

    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();
    const result = fireEvent.keyDown(document, { key: 'Escape' });
    expect(result).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('contains forward and reverse Tab inside the real menu panel', () => {
    render(<MenuHarness />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();
    fireEvent.click(opener);

    const close = screen.getByRole('button', { name: 'Close menu' });
    const backdrop = screen.getByRole('button', { name: 'Dismiss menu' });
    const cookbook = screen.getByRole('button', { name: 'Cookbook' });
    const last = screen.getByRole('button', { name: 'Unlock Premium Lemonade ($450)' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab' });
    expect(cookbook).toHaveFocus();

    fireEvent.keyDown(cookbook, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: 'Tab' });
    expect(close).toHaveFocus();
    expect(backdrop).not.toHaveFocus();
  });

  it('keeps outer modal Tab and Escape behaviour while entering menu subviews', () => {
    render(<MenuHarness />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole('button', { name: 'Cookbook' }));
    const back = screen.getByRole('button', { name: 'Back to menu' });
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(back).toHaveFocus();

    fireEvent.keyDown(back, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(back).toHaveFocus();
    fireEvent.keyDown(back, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Toasted Bread name' }));
    const name = screen.getByRole('textbox', { name: 'Dish name' });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Uncommitted name' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name).toHaveValue('Toasted Bread');
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Cancel' }), { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('recalculates the real panel order for dynamic inputs and removal controls', () => {
    gameState.current = createInitialState();
    render(<MenuModal isOpen onClose={vi.fn()} />);

    const cookbook = screen.getByRole('button', { name: 'Cookbook' });
    cookbook.focus();
    fireEvent.keyDown(cookbook, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Edit Toasted Bread name' })).toHaveFocus();

    const price = screen.getByLabelText('Toasted Bread price');
    const upgrade = screen.getByRole('button', { name: 'Upgrade Toasted Bread quality ($50)' });
    price.focus();
    fireEvent.keyDown(price, { key: 'Tab' });
    expect(upgrade).toHaveFocus();

    const remove = screen.getByRole('button', { name: 'Remove Toasted Bread from menu' });
    fireEvent.click(remove);
    expect(dispatch).toHaveBeenCalledWith({ type: 'REMOVE_DISH', id: 'starter-toast' });
    expect(screen.queryByRole('button', { name: /Confirm remove/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cookbook' })).toHaveFocus();
  });

  it('skips disabled real panel controls when containing Tab', () => {
    const base = createInitialState();
    gameState.current = { ...base, careerRun: { needsDecision: true } };
    render(<MenuModal isOpen onClose={vi.fn()} />);

    const close = screen.getByRole('button', { name: 'Close menu' });
    const cookbook = screen.getByRole('button', { name: 'Cookbook' });
    expect(screen.queryByRole('button', { name: /New dish/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Toasted Bread name' })).toBeDisabled();
    expect(screen.getByLabelText('Water price')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove Toasted Bread from menu' })).toBeDisabled();
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab' });
    expect(cookbook).toHaveFocus();

    fireEvent.keyDown(cookbook, { key: 'Tab' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(cookbook).toHaveFocus();
  });

  it('restores a real price draft on child Escape, then a later unconsumed Escape closes', () => {
    const onClose = vi.fn();
    render(<MenuHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    opener.focus();
    fireEvent.click(opener);

    const price = screen.getByLabelText('Water price');
    fireEvent.change(price, { target: { value: '50' } });
    expect(price).toHaveValue(50);

    const childResult = fireEvent.keyDown(price, { key: 'Escape' });
    expect(childResult).toBe(false);
    expect(price).toHaveValue(2);
    fireEvent.blur(price);
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Close menu' }), { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('reverts a name draft on child Escape without closing the modal', () => {
    gameState.current = createInitialState();
    const onClose = vi.fn();
    render(<MenuModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Toasted Bread name' }));
    const name = screen.getByRole('textbox', { name: 'Dish name' });
    fireEvent.change(name, { target: { value: 'Draft Toast' } });
    const childResult = fireEvent.keyDown(name, { key: 'Escape' });

    expect(childResult).toBe(false);
    expect(name).toHaveValue('Toasted Bread');
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();
  });

  it('leaves deliberate outside focus alone when a later Escape closes the modal', () => {
    render(<MenuHarness />);
    const opener = screen.getByRole('button', { name: 'Menu' });
    fireEvent.click(opener);
    const outside = screen.getByRole('button', { name: 'Outside menu' });

    outside.focus();
    expect(outside).toHaveFocus();
    fireEvent.keyDown(outside, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Menu' })).not.toBeInTheDocument();
    expect(outside).toHaveFocus();
    expect(opener).not.toHaveFocus();
  });

  it('does not duplicate listeners or close callbacks across reopen', () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const onClose = vi.fn();
    try {
      render(<MenuHarness onClose={onClose} />);
      const opener = screen.getByRole('button', { name: 'Menu' });
      const keydownAdds = () => addListener.mock.calls.filter(([type]) => type === 'keydown').length;
      const keydownRemoves = () => removeListener.mock.calls.filter(([type]) => type === 'keydown').length;

      opener.focus();
      fireEvent.click(opener);
      expect(keydownAdds()).toBe(1);
      expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(keydownRemoves()).toBe(1);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(opener).toHaveFocus();

      fireEvent.click(opener);
      expect(keydownAdds()).toBe(2);
      expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(keydownRemoves()).toBe(2);
      expect(onClose).toHaveBeenCalledTimes(2);
      expect(opener).toHaveFocus();
    } finally {
      addListener.mockRestore();
      removeListener.mockRestore();
    }
  });
});
