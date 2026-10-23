import { useLayoutEffect, useRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MenuPriceInput, { parseMenuPriceDraft } from './MenuPriceInput';

const setup = (overrides = {}) => {
  const props = { price: 8, label: 'Water price', disabled: false, ...overrides };
  const onCommit = vi.fn();
  const view = render(<MenuPriceInput {...props} onCommit={onCommit} />);
  return { view, unmount: view.unmount, props, onCommit, input: () => screen.getByLabelText(props.label) };
};

// Simulates a parent layout effect reacting to an external price/disabled update:
// focusout fires during the commit, before the input's passive reset effect can run.
const BlurOnRender = ({ price, disabled = false, onCommit }) => {
  const holder = useRef(null);
  useLayoutEffect(() => {
    const field = holder.current?.querySelector('input');
    if (field) field.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
  }, [price, disabled]);
  return (
    <div ref={holder}>
      <MenuPriceInput price={price} label="Water price" disabled={disabled} onCommit={onCommit} />
    </div>
  );
};

describe('MenuPriceInput', () => {
  it('renders the authoritative price with the existing number input contract', () => {
    const { input } = setup();
    const field = input();

    expect(field).toHaveValue(8);
    expect(field).toHaveAttribute('type', 'number');
    expect(field).toHaveAttribute('min', '1');
    expect(field).toHaveAttribute('max', '100');
    expect(field).toHaveAttribute('step', '1');
    expect(field).toHaveAttribute('title', 'Edit price');
    expect(field).toBeEnabled();
  });

  it('keeps typed text local without any interim commit', () => {
    const { input, onCommit } = setup();
    const field = input();

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.change(field, { target: { value: '1' } });
    fireEvent.change(field, { target: { value: '12' } });

    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue(12);
  });

  it('commits a changed draft exactly once on blur', () => {
    const { input, onCommit } = setup();
    const field = input();

    fireEvent.change(field, { target: { value: '9' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(field);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(9);
  });

  it('commits exactly once on Enter and ignores the following blur', () => {
    const { input, onCommit } = setup();
    const field = input();

    fireEvent.change(field, { target: { value: '9' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(9);

    fireEvent.blur(field);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('restores the authoritative price on Escape and never commits on the later blur', () => {
    const { input, onCommit } = setup();
    const field = input();

    fireEvent.change(field, { target: { value: '50' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue(8);

    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('treats an unchanged normalised price as a no-op', () => {
    const { input, onCommit } = setup({ price: 12 });
    const field = input();

    fireEvent.change(field, { target: { value: '12' } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '12.4' } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue(12);
  });

  it('reverts an empty draft on blur or Enter without committing', () => {
    const { input, onCommit } = setup();
    const field = input();

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue(8);

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue(8);
  });

  it('applies the existing 1-100 rounding policy to finite drafts', () => {
    const { input, onCommit } = setup();
    const field = input();

    fireEvent.change(field, { target: { value: '0' } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: '101' } });
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: '1.6' } });
    fireEvent.blur(field);

    expect(onCommit.mock.calls.map(([value]) => value)).toEqual([1, 100, 2]);
  });

  it('cancels a stale draft when the authoritative price changes', () => {
    const { input, onCommit, view } = setup();
    fireEvent.change(input(), { target: { value: '50' } });

    view.rerender(<MenuPriceInput price={20} label="Water price" disabled={false} onCommit={onCommit} />);
    expect(input()).toHaveValue(20);

    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('discards the draft when the field becomes disabled', () => {
    const { input, onCommit, view } = setup();
    fireEvent.change(input(), { target: { value: '50' } });

    view.rerender(<MenuPriceInput price={8} label="Water price" disabled onCommit={onCommit} />);
    expect(input()).toBeDisabled();
    expect(input()).toHaveValue(8);

    fireEvent.blur(input());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('does not commit on unmount', () => {
    const { input, onCommit, unmount } = setup();
    fireEvent.change(input(), { target: { value: '50' } });

    unmount();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('stops a consumed Escape before real ancestor and document keydown listeners', () => {
    const ancestor = document.createElement('div');
    const container = document.createElement('div');
    ancestor.appendChild(container);
    document.body.appendChild(ancestor);
    const ancestorKeys = [];
    const documentKeys = [];
    const ancestorListener = event => ancestorKeys.push(event.key);
    const documentListener = event => documentKeys.push(event.key);
    ancestor.addEventListener('keydown', ancestorListener);
    document.addEventListener('keydown', documentListener);

    try {
      const onCommit = vi.fn();
      render(
        <MenuPriceInput price={8} label="Water price" disabled={false} onCommit={onCommit} />,
        { container },
      );
      const field = within(container).getByLabelText('Water price');

      fireEvent.keyDown(field, { key: 'a' });
      expect(ancestorKeys).toEqual(['a']);
      expect(documentKeys).toEqual(['a']);

      fireEvent.change(field, { target: { value: '50' } });
      fireEvent.keyDown(field, { key: 'Escape' });

      expect(onCommit).not.toHaveBeenCalled();
      expect(field).toHaveValue(8);
      expect(ancestorKeys).toEqual(['a']);
      expect(documentKeys).toEqual(['a']);
    } finally {
      ancestor.remove();
      document.removeEventListener('keydown', documentListener);
    }
  });

  it('rejects a dirty draft synchronously when the authoritative price changed before the reset effect', () => {
    const onCommit = vi.fn();
    const view = render(<BlurOnRender price={8} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('Water price'), { target: { value: '50' } });

    view.rerender(<BlurOnRender price={20} onCommit={onCommit} />);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Water price')).toHaveValue(20);
  });

  it('never commits a dirty draft when the field is disabled before the reset effect', () => {
    const onCommit = vi.fn();
    const view = render(<BlurOnRender price={8} onCommit={onCommit} />);
    fireEvent.change(screen.getByLabelText('Water price'), { target: { value: '50' } });

    view.rerender(<BlurOnRender price={8} disabled onCommit={onCommit} />);

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Water price')).toHaveValue(8);
  });
});

describe('parseMenuPriceDraft', () => {
  it('rejects blank and non-finite drafts', () => {
    expect(parseMenuPriceDraft('')).toBeNull();
    expect(parseMenuPriceDraft('   ')).toBeNull();
    expect(parseMenuPriceDraft('abc')).toBeNull();
    expect(parseMenuPriceDraft('1e999')).toBeNull();
  });

  it('clamps and rounds finite drafts exactly like the reducers', () => {
    expect(parseMenuPriceDraft('0')).toBe(1);
    expect(parseMenuPriceDraft('101')).toBe(100);
    expect(parseMenuPriceDraft('1.6')).toBe(2);
    expect(parseMenuPriceDraft('12')).toBe(12);
  });
});
