import test from "node:test";
import assert from "node:assert/strict";
import { moneyToKopecks, kopecksToRubles, normalizeLocality, priceDeliveryZone } from "../services/delivery-pricing.js";

const baseZone = {
  id: 5,
  name: "Абакан и пригород",
  locality: "Абакан",
  deliveryPrice: "350.00",
  minOrderAmount: "1000.00",
  freeDeliveryFrom: "3000.00",
  isActive: true,
};

const price = (merchandiseTotal, zone = baseZone) => priceDeliveryZone({ zone, merchandiseTotal });

test("payable merchandise after promotions determines courier tariff", () => {
  const quote = price(2999.99);
  assert.equal(quote.deliveryPrice, 350);
  assert.equal(quote.snapshot.merchandiseTotal, 2999.99);
  assert.equal(quote.snapshot.discountBasis, "AFTER_PROMOTIONS");
  assert.equal(quote.snapshot.price, 350);
  assert.equal(quote.snapshot.freeDeliveryApplied, false);
});

test("free delivery is applied at threshold and above", () => {
  for (const payable of [3000, 3000.01, 20000]) {
    const quote = price(payable);
    assert.equal(quote.deliveryPrice, 0);
    assert.equal(quote.snapshot.freeDeliveryApplied, true);
    assert.equal(quote.deliveryPriceConfirmed, true);
  }
});

test("no threshold means paid courier delivery", () => {
  const quote = price(120000, { ...baseZone, freeDeliveryFrom: null });
  assert.equal(quote.deliveryPrice, 350);
  assert.equal(quote.snapshot.freeDeliveryFrom, null);
});

test("zero threshold supports permanently free zone", () => {
  assert.equal(price(1500, { ...baseZone, freeDeliveryFrom: "0.00" }).deliveryPrice, 0);
});

test("minimum order amount checked AFTER promotions", () => {
  assert.throws(() => price(999.99), (error) => error.code === "DELIVERY_MINIMUM_NOT_MET" && error.statusCode === 409);
  assert.equal(price(1000).deliveryPrice, 350);
});

test("inactive and unconfigured zones fail closed", () => {
  assert.throws(() => price(1000, { ...baseZone, isActive: false }), { code: "DELIVERY_ZONE_UNAVAILABLE" });
  assert.throws(() => price(1000, { ...baseZone, locality: null }), { code: "DELIVERY_ZONE_UNAVAILABLE" });
});

test("snapshot records old conditions after zone settings change", () => {
  const original = price(2800);
  price(2800, { ...baseZone, deliveryPrice: "800.00", freeDeliveryFrom: "2000.00" });
  assert.equal(original.snapshot.tariff, 350);
  assert.equal(original.snapshot.freeDeliveryFrom, 3000);
  assert.equal(original.snapshot.price, 350);
});

test("kopeck math avoids fraction drift and invalid amounts", () => {
  assert.equal(kopecksToRubles(moneyToKopecks("0.30") + moneyToKopecks("0.20")), 0.5);
  assert.equal(moneyToKopecks("349.99"), 34999);
  assert.throws(() => moneyToKopecks(-1), { code: "INVALID_AMOUNT" });
  assert.throws(() => moneyToKopecks(Infinity), { code: "INVALID_AMOUNT" });
});

test("normalize locality case and yo for comparable city names", () => {
  assert.equal(normalizeLocality("  ЧЕРНОГОРСК  "), "черногорск");
  assert.equal(normalizeLocality("Ёлкино"), "елкино");
});
