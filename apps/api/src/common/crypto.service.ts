import { Injectable } from "@nestjs/common";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

@Injectable()
export class CryptoService {
  private readonly piiKey = this.readKey("PII_ENCRYPTION_KEY_BASE64");
  private readonly blindKey = this.readKey("BLIND_INDEX_KEY_BASE64");
  private readonly sessionPepper = process.env.SESSION_PEPPER ?? "";

  encrypt(value: string): EncryptedValue {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.piiKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(value: EncryptedValue): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.piiKey,
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  blindIndex(value: string): string {
    return this.hmac(this.normalize(value));
  }

  searchTokens(value: string): string[] {
    const normalized = this.normalize(value).replace(/[^\p{L}\p{N}]/gu, "");
    if (!normalized) return [];
    const grams = new Set<string>();
    if (normalized.length === 1) grams.add(normalized);
    for (let index = 0; index < normalized.length - 1; index += 1) {
      grams.add(normalized.slice(index, index + 2));
    }
    return [...grams].sort().map((token) => this.hmac(`search:${token}`));
  }

  hashOpaqueToken(token: string): string {
    return createHash("sha256")
      .update(`${token}:${this.sessionPepper}`)
      .digest("hex");
  }

  safeTokenEquals(token: string, storedHash: string): boolean {
    const actual = Buffer.from(this.hashOpaqueToken(token));
    const expected = Buffer.from(storedHash);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  requestHash(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }

  private normalize(value: string): string {
    return value
      .normalize("NFKC")
      .trim()
      .toLocaleLowerCase("zh-CN")
      .replace(/\s+/g, " ");
  }

  private hmac(value: string): string {
    return createHmac("sha256", this.blindKey).update(value).digest("hex");
  }

  private readKey(name: string): Buffer {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
    return key;
  }
}
