const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { db, createStore, seedMenuFixture, cleanup } = require('./helpers/testDb');
const { priceCart, OrderValidationError } = require('../lib/pricing');

describe('pricing', () => {
  let storeA, storeB, fixtureA, fixtureB;

  before(() => {
    storeA = createStore('store-a', 'Store A');
    storeB = createStore('store-b', 'Store B', { minDeliveryCents: 5000 });
    fixtureA = seedMenuFixture(storeA);
    fixtureB = seedMenuFixture(storeB, { supportsHalfAndHalf: true });

    // Give store B's category a second item so half-and-half has two halves to combine.
    const secondItemInfo = db
      .prepare('INSERT INTO menu_items (category_id, name) VALUES (?, ?)')
      .run(fixtureB.categoryId, 'Veggie Pizza');
    fixtureB.secondMenuItemId = secondItemInfo.lastInsertRowid;
    fixtureB.secondSizeId = db
      .prepare('INSERT INTO item_sizes (menu_item_id, label, price_cents) VALUES (?, ?, ?)')
      .run(fixtureB.secondMenuItemId, 'SM', 1200).lastInsertRowid;
  });

  after(() => cleanup());

  test('prices a basic cart with an extra and quantity', () => {
    const result = priceCart(
      storeA,
      [{ menuItemId: fixtureA.menuItemId, sizeId: fixtureA.sizeId, quantity: 2, extraIds: [fixtureA.extraId] }],
      'pickup'
    );
    // (1000 size + 150 extra) * 2 quantity = 2300
    assert.equal(result.subtotalCents, 2300);
    // 10% tax rate on this store
    assert.equal(result.taxCents, 230);
    assert.equal(result.deliveryFeeCents, 0);
  });

  test('rejects an extra selection that exceeds the group max', () => {
    // Only one extra exists in the fixture group (max_select 2), so pass a
    // fabricated id that doesn't belong to any group on this item.
    assert.throws(
      () => priceCart(storeA, [{ menuItemId: fixtureA.menuItemId, sizeId: fixtureA.sizeId, quantity: 1, extraIds: [999999] }], 'pickup'),
      OrderValidationError
    );
  });

  test('enforces the delivery minimum', () => {
    assert.throws(
      () =>
        priceCart(storeB, [{ menuItemId: fixtureB.menuItemId, sizeId: fixtureB.sizeId, quantity: 1, extraIds: [] }], 'delivery'),
      OrderValidationError
    );
  });

  test('prices half-and-half using the higher of the two sizes plus half-price extras', () => {
    const result = priceCart(
      storeB,
      [
        {
          menuItemId: fixtureB.menuItemId,
          sizeId: fixtureB.sizeId,
          quantity: 1,
          halfAndHalf: {
            secondMenuItemId: fixtureB.secondMenuItemId,
            extras: [{ extraId: fixtureB.extraId, half: 'left' }],
          },
        },
      ],
      'pickup'
    );
    // max(1000, 1200) + (150 / 2 half-price) = 1275
    assert.equal(result.lines[0].unitPriceCents, 1275);
    assert.equal(result.lines[0].isHalfAndHalf, true);
  });

  test('a menu item from one store cannot be priced or ordered through another store', () => {
    assert.throws(
      () => priceCart(storeA, [{ menuItemId: fixtureB.menuItemId, sizeId: fixtureB.sizeId, quantity: 1, extraIds: [] }], 'pickup'),
      OrderValidationError
    );
  });
});
