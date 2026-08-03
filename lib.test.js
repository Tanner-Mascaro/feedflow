// AI use: Claude Sonnet 5 (Claude Code) helped write this test suite for Sprint 3's CI/CD pipeline.
const test = require("node:test");
const assert = require("node:assert/strict");
const { round2, nextTicketNo, validateMovementInput, computeBalances, combineBalances } = require("./lib.js");

test("round2 rounds to two decimal places", () => {
  assert.equal(round2(1.005), 1);
  assert.equal(round2(12.345), 12.35);
  assert.equal(round2(10), 10);
});

test("nextTicketNo starts at FF-01042 with no movements", () => {
  assert.equal(nextTicketNo([]), "FF-01042");
});

test("nextTicketNo increments past the highest existing id", () => {
  assert.equal(nextTicketNo([{ id: 5 }, { id: 1200 }, { id: 800 }]), "FF-01201");
});

test("validateMovementInput rejects a missing ingredient", () => {
  assert.equal(validateMovementInput("", 10), "Pick an ingredient.");
});

test("validateMovementInput rejects a zero or negative quantity", () => {
  assert.equal(validateMovementInput("Trout", 0), "Enter an amount greater than zero.");
  assert.equal(validateMovementInput("Trout", -5), "Enter an amount greater than zero.");
});

test("validateMovementInput passes a valid ingredient + qty", () => {
  assert.equal(validateMovementInput("Trout", 10), null);
});

test("computeBalances applies End = Beg + Received - ToMix - SoldRaw + Transferred + Adjusted", () => {
  const ingredients = ["Trout"];
  const opening = [{ location: "Midvale", ingredient: "Trout", qty: 100 }];
  const movements = [
    { location: "Midvale", ingredient: "Trout", type: "received", qty: 50 },
    { location: "Midvale", ingredient: "Trout", type: "to_mix", qty: 30 },
    { location: "Midvale", ingredient: "Trout", type: "sold_raw", qty: 10 },
    { location: "Midvale", ingredient: "Trout", type: "transferred", qty: -5 },
    { location: "Midvale", ingredient: "Trout", type: "adjusted", qty: 2 },
    { location: "Logan", ingredient: "Trout", type: "received", qty: 999 }, // different location, ignored
  ];
  const [row] = computeBalances(ingredients, movements, opening, "Midvale");
  assert.equal(row.beg, 100);
  assert.equal(row.received, 50);
  assert.equal(row.toMix, 30);
  assert.equal(row.soldRaw, 10);
  assert.equal(row.transferred, -5);
  assert.equal(row.adjusted, 2);
  assert.equal(row.end, 100 + 50 - 30 - 10 - 5 + 2);
});

test("computeBalances defaults beg to 0 when no opening balance is seeded", () => {
  const [row] = computeBalances(["Beef"], [], [], "Midvale");
  assert.equal(row.beg, 0);
  assert.equal(row.end, 0);
});

test("combineBalances sums matching ingredients across locations", () => {
  const midvale = computeBalances(["Trout"], [{ location: "Midvale", ingredient: "Trout", type: "to_mix", qty: 20 }], [{ location: "Midvale", ingredient: "Trout", qty: 100 }], "Midvale");
  const logan = computeBalances(["Trout"], [{ location: "Logan", ingredient: "Trout", type: "received", qty: 40 }], [{ location: "Logan", ingredient: "Trout", qty: 50 }], "Logan");
  const [combined] = combineBalances(midvale, logan);
  assert.equal(combined.beg, 150);
  assert.equal(combined.toMix, 20);
  assert.equal(combined.received, 40);
  assert.equal(combined.end, (100 - 20) + (50 + 40));
});
