import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv } from "../server/utils/csv";

test("CSV escapes quoted text and protects formula-like card names", () => {
  assert.equal(
    toCsv([["=1+1", 'A "card", blue', -2.5]]),
    '\uFEFF"\'=1+1","A ""card"", blue","-2.5"',
  );
});
