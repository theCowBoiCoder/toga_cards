import { test } from "node:test";
import assert from "node:assert/strict";
import { validAdminServiceKey } from "../server/utils/admin-service";

test("internal admin access requires an exact strong server-side key", () => {
  const key = "ab".repeat(32);
  assert.equal(validAdminServiceKey(key, key), true);
  assert.equal(validAdminServiceKey("bad", key), false);
  assert.equal(validAdminServiceKey(undefined, key), false);
  assert.equal(validAdminServiceKey("weak", "weak"), false);
  assert.equal(validAdminServiceKey("ab".repeat(31) + "cd", key), false);
});
