import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BookIcon from './BookIcon';
import MenuIcon from './MenuIcon';
import SettingsMenu from './SettingsMenu';

vi.mock('../state/GameContext', () => ({
  useGameState: () => ({}),
  useDispatch: () => vi.fn(),
}));

describe('top-right control positions', () => {
  it('uses the actual icon styles for Menu, Management, Settings horizontal order', () => {
    render(
      <>
        <MenuIcon onClick={() => {}} isOpen={false} />
        <BookIcon onClick={() => {}} isOpen={false} />
        <SettingsMenu isOpen={false} onToggle={() => {}} onClose={() => {}} />
      </>,
    );

    const controls = [
      screen.getByRole('button', { name: 'Menu' }),
      screen.getByTitle('Management'),
      screen.getByRole('button', { name: 'Settings' }),
    ];
    const rightOffsets = controls.map(control => Number.parseFloat(getComputedStyle(control).right));

    expect(rightOffsets).toEqual([120, 68, 16]);
    expect(rightOffsets[0]).toBeGreaterThan(rightOffsets[1]);
    expect(rightOffsets[1]).toBeGreaterThan(rightOffsets[2]);
    expect(controls.map(control => Number.parseFloat(getComputedStyle(control).width)))
      .toEqual([44, 44, 44]);
    expect(rightOffsets[0] - rightOffsets[1]).toBe(52);
    expect(rightOffsets[1] - rightOffsets[2]).toBe(52);
  });
});
