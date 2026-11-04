import { describe, expect, it, vi } from 'vitest';
import { SHOP_ITEMS } from '../panels/itemCatalog';
import { PLACEABLES } from './placeables';

const AMENITY_PRICES = {
  couch: 400,
  breakBench: 500,
  arcade: 800,
  bed: 500,
};

async function loadWithAmenityPrices(prices) {
  vi.resetModules();
  vi.doMock('./items', async () => {
    const actual = await vi.importActual('./items');
    return {
      ...actual,
      ITEM_PRICES: { ...actual.ITEM_PRICES, ...prices },
    };
  });

  try {
    const { PLACEABLES: placeables } = await import('./placeables');
    const { SHOP_ITEMS: shopItems } = await import('../panels/itemCatalog');
    return { placeables, shopItems };
  } finally {
    vi.doUnmock('./items');
    vi.resetModules();
  }
}

describe('amenity price source wiring', () => {
  it('keeps current production prices', () => {
    for (const [type, price] of Object.entries(AMENITY_PRICES)) {
      expect(PLACEABLES[type].price).toBe(price);
      expect(SHOP_ITEMS.find(item => item.type === type).price).toBe(price);
    }
  });

  it('propagates changed canonical prices to placeables and the shop', async () => {
    const changedPrices = { couch: 401, breakBench: 502, arcade: 802, bed: 503 };
    const { placeables, shopItems } = await loadWithAmenityPrices(changedPrices);

    for (const [type, price] of Object.entries(changedPrices)) {
      expect(placeables[type].price).toBe(price);
      expect(shopItems.find(item => item.type === type).price).toBe(price);
    }
  });
});
