"use strict";
const test = require("node:test");
const assert = require("node:assert");
const e = require("../server/engine");

test("headcount never goes below zero", () => {
  assert.equal(e.expectedHeadcount(50, 15), 35);
  assert.equal(e.expectedHeadcount(10, 20), 0);
});
test("ingredient plan applies the 5% buffer", () => {
  assert.deepEqual(e.ingredientPlan(35), { rice: 2.94, dal: 1.47, veg: 5.51 });
});
test("dinner cutoff is 4:00 PM IST", () => {
  assert.equal(e.cutoffTime("2026-11-25", "d").toISOString(), "2026-11-25T10:30:00.000Z");
  const cut = e.cutoffTime("2026-11-25", "d").getTime();
  assert.ok(e.isBeforeCutoff("2026-11-25", "d", cut));
  assert.ok(!e.isBeforeCutoff("2026-11-25", "d", cut + 1));
});
test("NGO alert fires strictly above 15 kg", () => {
  assert.ok(!e.shouldAlertNgo(15));
  assert.ok(e.shouldAlertNgo(15.01));
});
test("rebate is Rs 30 per skipped meal", () => assert.equal(e.rebateFor(3), 90));
