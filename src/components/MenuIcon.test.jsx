import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import MenuIcon from './MenuIcon';

it('exposes an accessible menu control and active state', () => {
  const onClick = vi.fn();
  render(<MenuIcon onClick={onClick} isOpen />);
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.getByTitle('Menu')).toHaveTextContent('🍽');
});
