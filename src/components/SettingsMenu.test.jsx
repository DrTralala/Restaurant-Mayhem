import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsMenu from './SettingsMenu';

const dispatch = vi.fn();
vi.mock('../state/GameContext', () => ({
  useDispatch: () => dispatch,
  useGameState: () => ({ careerRun: { needsDecision: true } }),
}));
beforeEach(() => dispatch.mockClear());

function settings(props = {}) {
  return <><SettingsMenu isOpen modal onToggle={() => {}} onClose={() => {}} {...props} />
    <button>Fit</button></>;
}

describe('Settings recovery focus ownership', () => {
  it('wraps actual focus from New game to Save game and backwards instead of escaping to Fit', () => {
    render(settings());
    const first = screen.getByRole('button', { name: 'Save game' });
    const last = screen.getByRole('button', { name: 'New game' });
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(first).toHaveFocus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(last).toHaveFocus();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('allows native interior Tab movement and button activation keys rather than swallowing all keys', () => {
    render(settings());
    const middle = screen.getByRole('button', { name: 'Load game' });
    middle.focus();
    expect(fireEvent.keyDown(middle, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(middle, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(middle, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(middle, { key: ' ', code: 'Space' })).toBe(true);
  });
  it('redirects escaped focus back inside the single labelled modal surface', () => {
    render(settings());
    screen.getByRole('button', { name: 'Fit' }).focus();
    expect(screen.getByRole('button', { name: 'Save game' })).toHaveFocus();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
  it('recomputes focusable actions when boundary buttons become disabled or enabled', () => {
    render(settings());
    const first = screen.getByRole('button', { name: 'Save game' });
    const middle = screen.getByRole('button', { name: 'Load game' });
    const last = screen.getByRole('button', { name: 'New game' });
    first.disabled = true;
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(middle).toHaveFocus();
    fireEvent.keyDown(middle, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    first.disabled = false;
    last.disabled = true;
    middle.focus();
    fireEvent.keyDown(middle, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(middle).toHaveFocus();
  });
  it('retains panel focus when all actions are disabled and permits a newly enabled action', () => {
    render(settings());
    const first = screen.getByRole('button', { name: 'Save game' });
    const panel = first.parentElement;
    for (const button of panel.querySelectorAll('button')) button.disabled = true;
    screen.getByRole('button', { name: 'Fit' }).focus();
    expect(panel).toHaveFocus();
    expect(fireEvent.keyDown(panel, { key: 'Tab' })).toBe(false);
    expect(fireEvent.keyDown(panel, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(panel).toHaveFocus();
    first.disabled = false;
    fireEvent.keyDown(panel, { key: 'Tab' });
    expect(first).toHaveFocus();
  });
  it('Escape closes only the recovery presentation without dispatching a gameplay action', () => {
    const onClose = vi.fn();
    render(settings({ onClose }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Save game' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('releases containment when closed or returned to ordinary non-modal usage', () => {
    const view = render(settings());
    view.rerender(settings({ isOpen: false }));
    screen.getByRole('button', { name: 'Fit' }).focus();
    expect(screen.getByRole('button', { name: 'Fit' })).toHaveFocus();
    view.rerender(settings());
    view.rerender(settings({ modal: false }));
    screen.getByRole('button', { name: 'Fit' }).focus();
    expect(screen.getByRole('button', { name: 'Fit' })).toHaveFocus();
  });
  it('preserves ordinary Settings focus entry, non-modal navigation and Escape behaviour', () => {
    const onClose = vi.fn();
    render(settings({ modal: false, onClose }));
    expect(screen.getByRole('button', { name: 'Save game' })).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const last = screen.getByRole('button', { name: 'New game' });
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(true);
    fireEvent.keyDown(last, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Fit' }).focus();
    expect(screen.getByRole('button', { name: 'Fit' })).toHaveFocus();
  });
});
