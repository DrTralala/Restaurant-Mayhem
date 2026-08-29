import { expect, it } from 'vitest';
import { interpolateSimulationState } from './interpolation';

it('interpolates moving character collections by id', () => {
  const previous = {
    staff: [{ id: 's', x: 0, y: 10 }],
    customers: [{ id: 'c', x: 10, y: 20 }],
    queue: [{ id: 'q', x: 20, y: 30 }],
  };
  const current = {
    ...previous,
    staff: [{ id: 's', x: 10, y: 20 }],
    customers: [{ id: 'c', x: 30, y: 40 }],
    queue: [{ id: 'q', x: 40, y: 50 }],
  };

  const rendered = interpolateSimulationState(previous, current, 0.5);

  expect(rendered.staff[0]).toMatchObject({ x: 5, y: 15 });
  expect(rendered.customers[0]).toMatchObject({ x: 20, y: 30 });
  expect(rendered.queue[0]).toMatchObject({ x: 30, y: 40 });
});

it('uses current positions for new entities and omits removed entities', () => {
  const previous = { staff: [{ id: 'gone', x: 0, y: 0 }], customers: [], queue: [] };
  const current = { staff: [{ id: 'new', x: 12, y: 14 }], customers: [], queue: [] };

  expect(interpolateSimulationState(previous, current, 0.5).staff)
    .toEqual([{ id: 'new', x: 12, y: 14 }]);
});

it('retains canonical non-positional state from the current snapshot', () => {
  const previous = { restaurant: { gameTime: 10 }, staff: [], customers: [], queue: [] };
  const current = { restaurant: { gameTime: 12 }, staff: [], customers: [], queue: [], funds: 50 };

  expect(interpolateSimulationState(previous, current, 0.25)).toMatchObject({
    restaurant: { gameTime: 12 },
    funds: 50,
  });
});
