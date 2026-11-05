import { test } from "node:test";
import assert from "node:assert/strict";
import catalogue from "../catalog/topps-premier-league-2026-27.json";
import { calculateSetProgress } from "../server/utils/set-progress";

const holdings = (quantity: number) =>
  catalogue.cards.map((card) => ({
    ...card,
    season: catalogue.season,
    collection: catalogue.collection,
    stock: quantity,
  }));
test("empty holdings cannot produce complete sets from an incomplete denominator", () => {
  const sets = calculateSetProgress([]);
  assert.equal(sets.length, 43);
  assert.equal(sets[0].total, 300);
  assert.equal(sets[0].completeSets, 0);
  assert.equal(sets[0].nextSetMissing, 300);
});
test("base includes Future Stars and is limited by the least-owned card", () => {
  const cards = holdings(2);
  cards[0].stock = 1;
  let base = calculateSetProgress(cards)[0];
  assert.equal(base.completeSets, 1);
  assert.equal(base.nextSetOwned, 299);
  assert.equal(base.nextSetMissing, 1);
  cards[0].stock++;
  base = calculateSetProgress(cards)[0];
  assert.equal(base.completeSets, 2);
  assert.equal(base.nextSetOwned, 0);
  cards[0].stock = 0; // Selling a limiting card reduces the number currently available.
  assert.equal(calculateSetProgress(cards)[0].completeSets, 0);
});
test("all types tracked independently; condition rows combine but seasons and parallels do not", () => {
  const cards = holdings(1);
  const first = cards[0];
  first.stock = 0;
  cards.push({ ...first, stock: 100, season: "2025/26" });
  cards.push({ ...first, stock: 100, variant: "Gold parallel" });
  assert.equal(calculateSetProgress(cards)[0].completeSets, 0);
  cards.push({ ...first, stock: 1 });
  const sets = calculateSetProgress(cards);
  assert.ok(sets.every((set) => set.completeSets === 1));
  const beasts = cards.filter((card) => card.variant === "Beast Mode");
  beasts.forEach((card) => (card.stock = 3));
  assert.equal(
    calculateSetProgress(cards).find((set) => set.section === "Beast Mode")
      ?.completeSets,
    3,
  );
  assert.equal(calculateSetProgress(cards)[0].completeSets, 1);
});
