import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsMenu from './SettingsMenu';

const dispatch = vi.fn();
const { requestNewSandboxMock } = vi.hoisted(() => ({ requestNewSandboxMock: vi.fn() }));
vi.mock('../state/GameContext', () => ({
  useDispatch: () => dispatch,
  useGameState: () => ({ careerRun: { needsDecision: true } }),
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
beforeEach(() => {
  dispatch.mockClear();
  requestNewSandboxMock.mockClear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

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

describe('Settings disclosure state', () => {
  function disclosure(props = {}) {
    return <SettingsMenu isOpen={false} modal={false} onToggle={() => {}} onClose={() => {}} {...props} />;
  }

  const settingsTrigger = () => screen.getByRole('button', { name: 'Settings' });

  it('reports collapsed ordinary and modal triggers without a panel reference', () => {
    const view = render(disclosure());
    expect(settingsTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(settingsTrigger()).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('button', { name: 'Save game' })).not.toBeInTheDocument();

    view.rerender(disclosure({ modal: true }));
    expect(settingsTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(settingsTrigger()).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('links an open ordinary panel and removes the reference when rerendered closed', () => {
    const view = render(disclosure());
    view.rerender(disclosure({ isOpen: true }));

    expect(settingsTrigger()).toHaveAttribute('aria-expanded', 'true');
    const panelId = settingsTrigger().getAttribute('aria-controls');
    const panel = document.getElementById(panelId);
    expect(panelId).toBeTruthy();
    expect(panel).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByRole('button', { name: 'Save game' }));
    expect(panel).not.toHaveAttribute('role');

    view.rerender(disclosure({ isOpen: false }));
    expect(settingsTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(settingsTrigger()).not.toHaveAttribute('aria-controls');
    expect(document.getElementById(panelId)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save game' })).not.toBeInTheDocument();

    view.rerender(disclosure({ isOpen: true }));
    expect(settingsTrigger()).toHaveAttribute('aria-controls', panelId);
  });

  it('links the open modal panel with its existing dialog semantics and removes it on close', () => {
    const view = render(disclosure({ modal: true }));
    view.rerender(disclosure({ modal: true, isOpen: true }));

    expect(settingsTrigger()).toHaveAttribute('aria-expanded', 'true');
    const panelId = settingsTrigger().getAttribute('aria-controls');
    const panel = screen.getByRole('dialog', { name: 'Settings' });
    expect(panel).toHaveAttribute('id', panelId);
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(document.getElementById(panelId)).toBe(panel);

    view.rerender(disclosure({ modal: true, isOpen: false }));
    expect(settingsTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(settingsTrigger()).not.toHaveAttribute('aria-controls');
    expect(document.getElementById(panelId)).toBeNull();
  });

  it('gives two instances stable unique panel ids and separate controls references', () => {
    const onToggle = () => {};
    const view = render(<>
      <SettingsMenu isOpen onToggle={onToggle} onClose={() => {}} />
      <SettingsMenu isOpen onToggle={onToggle} onClose={() => {}} />
    </>);
    const triggers = screen.getAllByRole('button', { name: 'Settings' });
    const panelIds = triggers.map(node => node.getAttribute('aria-controls'));
    expect(panelIds[0]).toBeTruthy();
    expect(panelIds[1]).toBeTruthy();
    expect(panelIds[0]).not.toBe(panelIds[1]);
    expect(document.getElementById(panelIds[0])).not.toBe(document.getElementById(panelIds[1]));
    expect(document.getElementById(panelIds[0])).toHaveAttribute('id', panelIds[0]);
    expect(document.getElementById(panelIds[1])).toHaveAttribute('id', panelIds[1]);

    view.rerender(<>
      <SettingsMenu isOpen={false} onToggle={onToggle} onClose={() => {}} />
      <SettingsMenu isOpen onToggle={onToggle} onClose={() => {}} />
    </>);
    const collapsedTriggers = screen.getAllByRole('button', { name: 'Settings' });
    expect(collapsedTriggers[0]).toHaveAttribute('aria-expanded', 'false');
    expect(collapsedTriggers[0]).not.toHaveAttribute('aria-controls');
    expect(collapsedTriggers[1]).toHaveAttribute('aria-controls', panelIds[1]);
    expect(document.getElementById(panelIds[0])).toBeNull();
    expect(document.getElementById(panelIds[1])).toBeInTheDocument();
  });

  it('keeps trigger toggling, initial action focus and modal close behaviour unchanged', () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    const view = render(disclosure({ modal: true, isOpen: true, onToggle, onClose }));
    const trigger = settingsTrigger();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Save game' })).toHaveFocus();
    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Load game' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    view.rerender(disclosure({ modal: false, isOpen: true, onToggle, onClose }));
    expect(screen.getByRole('button', { name: 'Save game' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Load game' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('confirmed sandbox reset', () => {
  const EXACT_CONFIRMATION = 'Start a new sandbox? This replaces your current restaurant, any career and its local autosave. No backup is created. Cancel keeps this restaurant.';

  it('cancels without removing storage, dispatching, closing or reporting success', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    const onClose = vi.fn();
    render(settings({ onClose }));

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(EXACT_CONFIRMATION);
    expect(requestNewSandboxMock).toHaveBeenCalledTimes(1);
    expect(requestNewSandboxMock).toHaveBeenCalledWith(dispatch);
    expect(removeItem).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('confirms with the exact copy, removes the autosave, dispatches fresh state and then closes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const removeItem = vi.spyOn(localStorage, 'removeItem');
    const onClose = vi.fn();
    localStorage.setItem('restaurant-sim-save', JSON.stringify({ synthetic: true }));
    render(settings({ onClose }));

    fireEvent.click(screen.getByRole('button', { name: 'New game' }));

    expect(confirm).toHaveBeenCalledWith(EXACT_CONFIRMATION);
    expect(requestNewSandboxMock).toHaveBeenCalledWith(dispatch);
    expect(removeItem).toHaveBeenCalledTimes(1);
    expect(removeItem).toHaveBeenCalledWith('restaurant-sim-save');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'LOAD_STATE',
      state: expect.objectContaining({
        careerRun: null,
        restaurant: expect.objectContaining({ funds: 600, day: 1 }),
      }),
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('New game started');
  });
});
