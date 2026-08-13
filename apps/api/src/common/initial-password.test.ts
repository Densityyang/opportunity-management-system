import assert from "node:assert/strict";
import test from "node:test";
import { initialPasswordFromPhone } from "./initial-password";

test("initial password is the normalized phone suffix", () => {
  assert.equal(initialPasswordFromPhone(" 13800000000 "), "000000");
});

test("initial password derivation rejects invalid phone numbers", () => {
  assert.throws(() => initialPasswordFromPhone("1380000000"));
});
