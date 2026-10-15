import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";
import express, { Router } from "express";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { normalizeRussianPhone } from "../utils/phone.js";
import { businessDateKey, isValidDateOnly } from "../utils/dates.js";

test("real checkout router rejects impossible/past dates, accepts valid dates and rejects forged price", async () => {
  const success = (req, res) => res.json({ ok: true, data: req.validated });
  const modules = {
    express: { Router }, zod: { z },
    "../utils/dates.js": { businessDateKey, isValidDateOnly },
    "../controllers/checkout.controller.js": { createOrder: success, readCheckout: success },
    "../middleware/rate-limit.js": { checkoutRateLimiter: (_req, _res, next) => next() },
    "../middleware/validate.js": { validate }, "../utils/phone.js": { normalizeRussianPhone },
  };
  const module = new SourceTextModule(await readFile(new URL("../routes/checkout.routes.js", import.meta.url), "utf8"));
  await module.link((name) => new SyntheticModule(Object.keys(modules[name]), function () {
    for (const [key, value] of Object.entries(modules[name])) this.setExport(key, value);
  }));
  await module.evaluate();
  const app = express();
  app.use(express.json(), module.namespace.default);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const body = { idempotencyKey: "cb6e8f29-05b2-4b96-8559-b6c5efc86812", name: "Тест", phone: "+79991234567", email: "test@example.com", receiveMethod: "pickup", receiveDate: businessDateKey(), paymentMethod: "on-receipt", agreement: true };
  const post = (input) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  try {
    assert.equal((await post(body)).status, 200);
    for (const receiveDate of ["2099-02-31", "2099-04-31", "2000-01-01"]) assert.equal((await post({ ...body, receiveDate })).status, 400);
    assert.equal((await post({ ...body, receiveDate: "2028-02-29" })).status, 200);
    assert.equal((await post({ ...body, deliveryPrice: 0 })).status, 400);
    assert.equal((await fetch(`${url}/?date=2099-02-31`)).status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
