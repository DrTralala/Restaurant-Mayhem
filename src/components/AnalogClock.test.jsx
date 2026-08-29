import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import AnalogClock from './AnalogClock';

it('renders the game time and analogue hand angles', () => {
  render(<AnalogClock gameTime={3 * 3600 + 30 * 60} />);

  expect(screen.getByLabelText('3:30 AM')).toBeInTheDocument();
  expect(screen.getByTestId('hour-hand')).toHaveStyle({ transform: 'rotate(105deg)' });
  expect(screen.getByTestId('minute-hand')).toHaveStyle({ transform: 'rotate(180deg)' });
});
