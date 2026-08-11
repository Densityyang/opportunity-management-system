import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const districts = [
  ["510104", "锦江区"],
  ["510105", "青羊区"],
  ["510106", "金牛区"],
  ["510107", "武侯区"],
  ["510108", "成华区"],
  ["510112", "龙泉驿区"],
  ["510113", "青白江区"],
  ["510114", "新都区"],
  ["510115", "温江区"],
  ["510116", "双流区"],
  ["510117", "郫都区"],
  ["510118", "新津区"],
  ["510181", "都江堰市"],
  ["510182", "彭州市"],
  ["510183", "邛崃市"],
  ["510184", "崇州市"],
  ["510185", "简阳市"],
  ["510121", "金堂县"],
  ["510129", "大邑县"],
  ["510131", "蒲江县"],
] as const;

function readKey(name: string): Buffer {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes`);
  return key;
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    readKey("PII_ENCRYPTION_KEY_BASE64"),
    iv,
  );
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

function blindIndex(value: string): string {
  return createHmac("sha256", readKey("BLIND_INDEX_KEY_BASE64"))
    .update(value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN"))
    .digest("hex");
}

async function main(): Promise<void> {
  for (const [code, name] of districts) {
    await prisma.district.upsert({
      where: { code },
      create: { code, name },
      update: { name },
    });
  }

  const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone))
    throw new Error(
      "BOOTSTRAP_ADMIN_PHONE must be a valid mainland China mobile number",
    );
  if (!password || password.length < 12)
    throw new Error(
      "BOOTSTRAP_ADMIN_PASSWORD must have at least 12 characters",
    );
  const encrypted = encrypt(phone);
  const phoneBlindIndex = blindIndex(phone);
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const user = await prisma.user.upsert({
    where: { phoneBlindIndex },
    create: {
      phoneCiphertext: encrypted.ciphertext,
      phoneIv: encrypted.iv,
      phoneTag: encrypted.tag,
      phoneBlindIndex,
      displayName: "系统管理员",
      credential: { create: { passwordHash } },
    },
    update: { active: true },
  });
  const existingGrant = await prisma.roleGrant.findFirst({
    where: { userId: user.id, role: "SYSTEM_ADMIN", districtId: null },
  });
  if (!existingGrant)
    await prisma.roleGrant.create({
      data: { userId: user.id, role: "SYSTEM_ADMIN" },
    });
}

main().finally(async () => prisma.$disconnect());
