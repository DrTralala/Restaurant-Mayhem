import { describe, expect, it, vi } from 'vitest';
import { drawHighTopCounter } from './highTopCounterDrawing';

function context() {
  return { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    drawImage: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn() };
}

const loadedImage = () => ({ complete: true, naturalWidth: 320, naturalHeight: 160 });

describe('high top counter artwork', () => {
  it.each([
    [0, 340, 320], [1, 320, 340], [2, 340, 320], [3, 320, 340],
  ])('draws one complete counter sprite without duplicate stools at rotation %i', (rotation, centreX, centreY) => {
    const ctx = context();
    const image = loadedImage();
    drawHighTopCounter(ctx, { id: 'htc1', x: 300, y: 300, rotation }, [], {
      highTopCounter: image, chair: loadedImage(),
    });
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 320, 160, -40, -20, 80, 40);
    expect(ctx.translate).toHaveBeenCalledWith(centreX, centreY);
    expect(ctx.rotate).toHaveBeenCalledWith(rotation * Math.PI / 2);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });

  it('draws dirt over only the dirty place after the counter sprite', () => {
    const ctx = context();
    drawHighTopCounter(ctx, { id: 'htc1', x: 300, y: 300, rotation: 1 }, [
      { highTopCounterId: 'htc1', counterSeatIndex: 1, status: 'dirty' },
      { highTopCounterId: 'htc1', counterSeatIndex: 2, status: 'occupied' },
      { highTopCounterId: 'other', counterSeatIndex: 3, status: 'dirty' },
    ], { highTopCounter: loadedImage() });
    expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(320, 320, 20, 20);
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeGreaterThan(ctx.drawImage.mock.invocationCallOrder[0]);
  });

  it.each([undefined, { complete: false }, { complete: true, naturalWidth: 0, naturalHeight: 0 }])(
    'retains the primitive counter and stools while the image is unavailable (%j)', image => {
      const ctx = context();
      drawHighTopCounter(ctx, { id: 'htc1', x: 300, y: 300, rotation: 0 }, [], { highTopCounter: image });
      expect(ctx.drawImage).not.toHaveBeenCalled();
      expect(ctx.fillRect).toHaveBeenCalledTimes(5);
      expect(ctx.fillRect).toHaveBeenCalledWith(300, 300, 80, 20);
      expect(ctx.fillRect).toHaveBeenCalledWith(300, 320, 20, 20);
      expect(ctx.fillRect).toHaveBeenCalledWith(360, 320, 20, 20);
    },
  );
});
