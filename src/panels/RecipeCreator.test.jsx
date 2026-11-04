import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RecipeCreator from './RecipeCreator';

const toast = {
  id: 'starter-toast', cookbookId: 'toast', name: 'Toasted Bread',
  base: 'Bread', method: 'Toasted', cuisine: 'generic', requiredEquipmentId: 'eq1',
  prepTime: 60, popularity: 50, price: 12, quality: 1,
};

function renderEditor(props = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const view = render(<RecipeCreator dish={toast} onCommit={onCommit} onCancel={onCancel} {...props} />);
  return { ...view, onCommit, onCancel };
}

describe('RecipeCreator name editor', () => {
  it('focuses a labelled name field and exposes no arbitrary recipe creation controls', () => {
    renderEditor();

    const name = screen.getByRole('textbox', { name: 'Dish name' });
    expect(name).toHaveValue('Toasted Bread');
    expect(name).toHaveFocus();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });

  it('trims and commits the active dish name on blur and Enter exactly once', () => {
    const { onCommit } = renderEditor();
    const name = screen.getByRole('textbox', { name: 'Dish name' });

    fireEvent.change(name, { target: { value: '  House Toast  ' } });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenLastCalledWith('House Toast');

    fireEvent.change(name, { target: { value: 'Brunch Toast' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith('Brunch Toast');
    fireEvent.blur(name);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('rejects blank names on blur and Enter, and Cancel leaves dispatch to the parent', () => {
    const { onCommit, onCancel } = renderEditor();
    const name = screen.getByRole('textbox', { name: 'Dish name' });

    fireEvent.change(name, { target: { value: '   ' } });
    fireEvent.blur(name);
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a dish name.')).toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('reverts the draft on Escape without dispatching or bubbling to the modal', () => {
    const { onCommit } = renderEditor();
    const name = screen.getByRole('textbox', { name: 'Dish name' });
    const outerKeyDown = vi.fn();
    document.addEventListener('keydown', outerKeyDown);

    fireEvent.change(name, { target: { value: 'Unsaved Toast' } });
    const result = fireEvent.keyDown(name, { key: 'Escape' });

    expect(result).toBe(false);
    expect(name).toHaveValue('Toasted Bread');
    expect(onCommit).not.toHaveBeenCalled();
    expect(outerKeyDown).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outerKeyDown);
  });

  it('discards drafts when the authoritative name or dish identity changes', () => {
    const { rerender, onCommit } = renderEditor();
    const name = screen.getByRole('textbox', { name: 'Dish name' });

    fireEvent.change(name, { target: { value: 'Draft Toast' } });
    rerender(<RecipeCreator dish={{ ...toast, name: 'Renamed elsewhere' }} onCommit={onCommit} onCancel={vi.fn()} />);
    expect(name).toHaveValue('Renamed elsewhere');

    fireEvent.change(name, { target: { value: 'Another draft' } });
    rerender(<RecipeCreator dish={{ ...toast, id: 'new-active-id', name: 'Renamed elsewhere', method: 'Baked' }}
      onCommit={onCommit} onCancel={vi.fn()} />);
    expect(name).toHaveValue('Renamed elsewhere');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('disables the input and clears a dirty draft when mutations become blocked', () => {
    const { rerender, onCommit } = renderEditor();
    const name = screen.getByRole('textbox', { name: 'Dish name' });

    fireEvent.change(name, { target: { value: 'Draft Toast' } });
    rerender(<RecipeCreator dish={toast} disabled onCommit={onCommit} onCancel={vi.fn()} />);

    expect(name).toBeDisabled();
    expect(name).toHaveValue('Toasted Bread');
    fireEvent.blur(name);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
