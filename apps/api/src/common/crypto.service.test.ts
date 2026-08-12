import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { CryptoService } from "./crypto.service";

process.env.PII_ENCRYPTION_KEY_BASE64 = randomBytes(32).toString("base64");
process.env.BLIND_INDEX_KEY_BASE64 = randomBytes(32).toString("base64");
process.env.SESSION_PEPPER = "test-session-pepper";

test("PII encryption round-trips without exposing plaintext", () => {
  const service = new CryptoService();
  const encrypted = service.encrypt("客户联系方式 13800138000");
  assert.notEqual(encrypted.ciphertext, "客户联系方式 13800138000");
  assert.equal(service.decrypt(encrypted), "客户联系方式 13800138000");
});

test("blind indexes normalize equivalent search values", () => {
  const service = new CryptoService();
  assert.equal(
    service.blindIndex("  Test@example.com "),
    service.blindIndex("test@example.com"),
  );
  assert.deepEqual(service.searchTokens("A-12"), service.searchTokens("a 12"));
});

test("opaque token verification uses a one-way hash", () => {
  const service = new CryptoService();
  const token = "reauth-token";
  const digest = service.hashOpaqueToken(token);
  assert.equal(service.safeTokenEquals(token, digest), true);
  assert.equal(service.safeTokenEquals("different-token", digest), false);
});
