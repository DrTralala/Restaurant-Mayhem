import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAnimationFrameLoop } from './useAnimationFrameLoop';

function Harness({ callback, enabled = true }) {
  useAnimationFrameLoop(callback, { enabled });
  return null;
}

const frames = [];

beforeEach(() => {
  frames.length = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => {
    frames.push(callback);
    return frames.length;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => vi.unstubAllGlobals());

it('stops scheduling when the callback returns false', () => {
  const callback = vi.fn(() => false);
  render(<Harness callback={callback} />);

  act(() => frames.shift()(100));

  expect(callback).toHaveBeenCalledOnce();
  expect(frames).toHaveLength(0);
});

it('uses the latest callback without restarting the loop', () => {
  const firstCallback = vi.fn(() => true);
  const latestCallback = vi.fn(() => false);
  const view = render(<Harness callback={firstCallback} />);

  view.rerender(<Harness callback={latestCallback} />);
  act(() => frames.shift()(100));

  expect(firstCallback).not.toHaveBeenCalled();
  expect(latestCallback).toHaveBeenCalledOnce();
  expect(frames).toHaveLength(0);
});

it('does not schedule while disabled and restarts when enabled', () => {
  const callback = vi.fn(() => true);
  const view = render(<Harness callback={callback} enabled={false} />);
  expect(frames).toHaveLength(0);

  view.rerender(<Harness callback={callback} enabled />);
  expect(frames).toHaveLength(1);
});

it('cancels its scheduled frame on unmount', () => {
  const callback = vi.fn(() => true);
  const view = render(<Harness callback={callback} />);
  expect(frames).toHaveLength(1);

  view.unmount();

  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});
