import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsMenu from './SettingsMenu';
import { SAVE_VERSION } from '../state/saveVersion';

const dispatch = vi.fn();
const {
  requestNewSandboxMock,
  loadLatestRepositoryStateMock,
  saveRepositoryStateMock,
  hydrateStateMock,
} = vi.hoisted(() => ({
  requestNewSandboxMock: vi.fn(),
  loadLatestRepositoryStateMock: vi.fn(),
  saveRepositoryStateMock: vi.fn(),
  hydrateStateMock: vi.fn(),
}));
vi.mock('../state/GameContext', () => ({
  useDispatch: () => dispatch,
  useGameState: () => ({ careerRun: { needsDecision: true } }),
}));
vi.mock('../state/repositorySaves', () => ({
  loadLatestRepositoryState: loadLatestRepositoryStateMock,
  saveRepositoryState: saveRepositoryStateMock,
}));
vi.mock('../state/persistence', async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, hydrateState: (...args) => hydrateStateMock(...args) };
});
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
  loadLatestRepositoryStateMock.mockReset();
  saveRepositoryStateMock.mockReset();
  hydrateStateMock.mockReset();
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

describe('asynchronous Settings ownership', () => {
  function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  }

  function compatibleLoad(filename = 'save.json') {
    return { state: { version: SAVE_VERSION, filename }, filename };
  }

  async function settle(request, outcome) {
    await act(async () => {
      outcome(request);
      try {
        await request.promise;
      } catch {
        // The load handler owns the result of rejected requests.
      }
    });
  }

  it('does not commit a load after the owning Settings instance unmounts', async () => {
    const request = deferred();
    loadLatestRepositoryStateMock.mockReturnValue(request.promise);
    const view = render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    view.unmount();
    await settle(request, pending => pending.resolve(compatibleLoad('old-session.json')));

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'LOAD_STATE' }));
    expect(hydrateStateMock).not.toHaveBeenCalled();
  });

  it('invalidates pending loads synchronously when New game is confirmed without a remount', async () => {
    const request = deferred();
    loadLatestRepositoryStateMock.mockReturnValue(request.promise);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'LOAD_STATE' }));

    await settle(request, pending => pending.resolve(compatibleLoad('old-session.json')));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(hydrateStateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('New game started');
  });

  it('allows only the newest overlapping load to hydrate, dispatch and report success', async () => {
    const older = deferred();
    const newer = deferred();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    loadLatestRepositoryStateMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const hydrated = { loaded: 'newer' };
    hydrateStateMock.mockReturnValue(hydrated);
    render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    await settle(newer, pending => pending.resolve(compatibleLoad('newer.json')));
    await settle(older, pending => pending.resolve(compatibleLoad('older.json')));

    expect(hydrateStateMock).toHaveBeenCalledTimes(1);
    expect(hydrateStateMock).toHaveBeenCalledWith(compatibleLoad('newer.json').state, expect.any(Object));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/replace.*current/i));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'LOAD_STATE', state: hydrated });
    expect(screen.getByRole('status')).toHaveTextContent('Loaded newer.json');
  });

  it('does not report a stale rejection after a newer request succeeds', async () => {
    const older = deferred();
    const newer = deferred();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    loadLatestRepositoryStateMock
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    hydrateStateMock.mockReturnValue({ loaded: 'newer' });
    render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    await settle(newer, pending => pending.resolve(compatibleLoad('newer.json')));
    await settle(older, pending => pending.reject(new Error('stale load failed')));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Loaded newer.json');
    expect(screen.queryByText('stale load failed')).not.toBeInTheDocument();
  });

  it('does not dispatch a valid load when replacement is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    loadLatestRepositoryStateMock.mockResolvedValueOnce(compatibleLoad('declined.json'));
    hydrateStateMock.mockReturnValue({ loaded: 'declined' });
    render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/replace.*current/i));
    expect(hydrateStateMock).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not dispatch if the request becomes stale while confirmation is open', async () => {
    const request = deferred();
    const newer = deferred();
    loadLatestRepositoryStateMock
      .mockReturnValueOnce(request.promise)
      .mockReturnValueOnce(newer.promise);
    hydrateStateMock.mockReturnValue({ loaded: 'stale-after-confirm' });
    const confirm = vi.spyOn(window, 'confirm').mockImplementation(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
      return true;
    });
    render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    await settle(request, pending => pending.resolve(compatibleLoad('superseded.json')));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/replace.*current/i));
    expect(hydrateStateMock).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not invalidate a load when the panel is ordinarily closed and reopened', async () => {
    const request = deferred();
    const hydrated = { loaded: true };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    loadLatestRepositoryStateMock.mockReturnValue(request.promise);
    hydrateStateMock.mockReturnValue(hydrated);
    const view = render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    view.rerender(settings({ isOpen: false }));
    view.rerender(settings({ isOpen: true }));
    await settle(request, pending => pending.resolve(compatibleLoad()));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'LOAD_STATE', state: hydrated });
    expect(screen.getByRole('status')).toHaveTextContent('Loaded save.json');
  });

  it('keeps load ownership valid after StrictMode effect cleanup and setup', async () => {
    const request = deferred();
    const hydrated = { loaded: true };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    loadLatestRepositoryStateMock.mockReturnValue(request.promise);
    hydrateStateMock.mockReturnValue(hydrated);
    render(<StrictMode>{settings()}</StrictMode>);

    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));
    await settle(request, pending => pending.resolve(compatibleLoad()));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'LOAD_STATE', state: hydrated });
    expect(screen.getByRole('status')).toHaveTextContent('Loaded save.json');
  });

  it('shows current incompatible and rejected load results', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    loadLatestRepositoryStateMock.mockResolvedValueOnce({
      state: { version: SAVE_VERSION - 1 }, filename: 'incompatible.json',
    });
    render(settings());
    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved game is incompatible');
    expect(dispatch).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();

    loadLatestRepositoryStateMock.mockRejectedValueOnce(new Error('current load failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Load game' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('current load failed'));
    expect(dispatch).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('does not show a save completion message after unmount', async () => {
    const request = deferred();
    saveRepositoryStateMock.mockReturnValue(request.promise);
    const view = render(settings());

    fireEvent.click(screen.getByRole('button', { name: 'Save game' }));
    expect(saveRepositoryStateMock).toHaveBeenCalledWith({ careerRun: { needsDecision: true } });
    view.unmount();
    await settle(request, pending => pending.resolve({ filename: 'saved.json' }));

    expect(screen.queryByText('Saved as saved.json')).not.toBeInTheDocument();
  });
});
