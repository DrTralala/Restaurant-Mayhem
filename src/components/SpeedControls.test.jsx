import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SpeedControls from './SpeedControls';

const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('../state/GameContext', () => ({
  useGameState: () => ({ paused: false, speed: 4 }),
  useDispatch: () => dispatch,
}));

describe('SpeedControls', () => {
  beforeEach(() => {
    dispatch.mockClear();
  });

  it('renders the bottom control row in AMOLED black', () => {
    render(<SpeedControls />);

    expect(screen.getByRole('button', { name: '1x' }).parentElement).toHaveStyle({
      background: '#000000',
    });
  });

  it('requests a whole-layout fit from the bottom control row', () => {
    const onFit = vi.fn();
    render(<SpeedControls onFit={onFit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));

    expect(onFit).toHaveBeenCalledOnce();
  });

  it('toggles once on Space, not on key repeat', () => {
    render(<SpeedControls />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat: true });

    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);
  });

  it('toggles once per distinct Space keypress', () => {
    render(<SpeedControls />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyDown(window, { key: ' ', code: 'Space' });

    expect(dispatch.mock.calls).toEqual([
      [{ type: 'TOGGLE_PAUSE' }],
      [{ type: 'TOGGLE_PAUSE' }],
    ]);
  });

  it.each([
    ['input', host => {
      const input = document.createElement('input');
      host.append(input);
      return input;
    }],
    ['textarea', host => {
      const textarea = document.createElement('textarea');
      host.append(textarea);
      return textarea;
    }],
    ['select', host => {
      const select = document.createElement('select');
      host.append(select);
      return select;
    }],
    ['button', host => {
      const button = document.createElement('button');
      host.append(button);
      return button;
    }],
    ['contenteditable ancestor', host => {
      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true');
      const child = document.createElement('span');
      editable.append(child);
      host.append(editable);
      return child;
    }],
  ])('leaves a focused %s untouched by the Space shortcut', (_label, createTarget) => {
    render(<SpeedControls />);
    const host = document.createElement('div');
    document.body.append(host);
    try {
      const target = createTarget(host);
      expect(fireEvent.keyDown(target, { key: ' ', code: 'Space' })).toBe(true);
    } finally {
      host.remove();
    }

    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'])(
    'ignores Space held with %s', modifier => {
      render(<SpeedControls />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space', [modifier]: true });

      expect(dispatch).not.toHaveBeenCalled();
    },
  );

  it('ignores Space emitted during IME composition', () => {
    render(<SpeedControls />);
    fireEvent.keyDown(window, { key: ' ', code: 'Space', isComposing: true });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores a Space keydown that a prior handler already handled', () => {
    render(<SpeedControls />);
    const swallow = event => event.preventDefault();
    document.addEventListener('keydown', swallow);
    try {
      fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    } finally {
      document.removeEventListener('keydown', swallow);
    }

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('prevents the default action of an unhandled Space keydown', () => {
    render(<SpeedControls />);

    expect(fireEvent.keyDown(window, { key: ' ', code: 'Space' })).toBe(false);
    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);
  });

  it('stops toggling after unmount', () => {
    const view = render(<SpeedControls />);
    view.unmount();

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('exposes the shortcut on the pause button and dispatches once on click', () => {
    render(<SpeedControls />);
    const pauseButton = screen.getByRole('button', { name: 'Pause game' });

    expect(pauseButton).toHaveAttribute('aria-keyshortcuts', 'Space');
    expect(pauseButton.title).toMatch(/Space/);

    fireEvent.click(pauseButton);

    expect(dispatch.mock.calls).toEqual([[{ type: 'TOGGLE_PAUSE' }]]);
  });
});
