import { describe, expect, it } from 'vitest';
import * as movementFacade from './movement';

describe('movement facade', () => {
  it('preserves the final movement facade and function arities', () => {
    expect(Object.keys(movementFacade).sort()).toEqual([
      'advanceCharacterMovementBatch',
      'createMovementCoordinator',
      'getCharacterMovementStatus',
    ]);
    expect(Object.fromEntries(Object.entries(movementFacade)
      .map(([name, implementation]) => [name, implementation.length]))).toEqual({
      advanceCharacterMovementBatch: 3,
      createMovementCoordinator: 0,
      getCharacterMovementStatus: 2,
    });
  });
});
