// Money is calculated on the server in integer kopecks. No prices or thresholds
// are accepted from checkout/quote API clients.
export const deliveryConfig = Object.freeze({
  currency: "RUB",
  maxPriceKopecks: 100_000_000_000,
});
