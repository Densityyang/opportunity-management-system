import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { initialPasswordFromPhone } from "../src/common/initial-password";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const districts = [
  ["510106", "金牛", 1],
  ["510108", "成华", 2],
  ["510105", "青羊", 3],
  ["510104", "锦江", 4],
  ["510107", "武侯", 5],
  ["GX_NAN", "高新南", 6],
  ["GX_XI", "高新西", 7],
  ["DB_XQ", "东部新区", 8],
  ["510129", "大邑", 9],
  ["510185", "简阳", 10],
  ["510121", "金堂", 11],
  ["510114", "新都", 12],
  ["510115", "温江", 13],
  ["510117", "郫都", 14],
  ["510182", "彭州", 15],
  ["510184", "崇州", 16],
  ["510118", "新津", 17],
  ["510183", "邛崃", 18],
  ["510131", "蒲江", 19],
  ["510113", "青白江", 20],
  ["510181", "都江堰", 21],
  ["TF_XQ", "天府新区", 22],
  ["510112", "龙泉驿", 23],
] as const;

const mappingRules: Array<{
  name: string;
  includeText: string;
  excludeText?: string;
  priority: number;
  districtCode: string;
}> = [
  {
    name: "金牛关键词",
    includeText: "金牛",
    priority: 100,
    districtCode: "510106",
  },
  {
    name: "成华关键词",
    includeText: "成华",
    priority: 100,
    districtCode: "510108",
  },
  {
    name: "青羊关键词",
    includeText: "青羊",
    priority: 100,
    districtCode: "510105",
  },
  {
    name: "锦江关键词",
    includeText: "锦江",
    priority: 100,
    districtCode: "510104",
  },
  {
    name: "武侯关键词",
    includeText: "武侯",
    priority: 100,
    districtCode: "510107",
  },
  {
    name: "高新南关键词",
    includeText: "高新南",
    priority: 100,
    districtCode: "GX_NAN",
  },
  {
    name: "高新西关键词",
    includeText: "高新西",
    priority: 100,
    districtCode: "GX_XI",
  },
  {
    name: "东部新区关键词",
    includeText: "东部新区",
    priority: 100,
    districtCode: "DB_XQ",
  },
  {
    name: "大邑关键词",
    includeText: "大邑",
    priority: 100,
    districtCode: "510129",
  },
  {
    name: "简阳关键词",
    includeText: "简阳",
    priority: 100,
    districtCode: "510185",
  },
  {
    name: "金堂关键词",
    includeText: "金堂",
    priority: 100,
    districtCode: "510121",
  },
  {
    name: "新都关键词",
    includeText: "新都",
    priority: 100,
    districtCode: "510114",
  },
  {
    name: "温江关键词",
    includeText: "温江",
    priority: 100,
    districtCode: "510115",
  },
  {
    name: "郫都关键词",
    includeText: "郫都",
    priority: 100,
    districtCode: "510117",
  },
  {
    name: "郫县兼容关键词",
    includeText: "郫县",
    priority: 100,
    districtCode: "510117",
  },
  {
    name: "彭州关键词",
    includeText: "彭州",
    priority: 100,
    districtCode: "510182",
  },
  {
    name: "崇州关键词",
    includeText: "崇州",
    priority: 100,
    districtCode: "510184",
  },
  {
    name: "新津关键词",
    includeText: "新津",
    priority: 100,
    districtCode: "510118",
  },
  {
    name: "邛崃关键词",
    includeText: "邛崃",
    priority: 100,
    districtCode: "510183",
  },
  {
    name: "蒲江关键词",
    includeText: "蒲江",
    priority: 100,
    districtCode: "510131",
  },
  {
    name: "青白江关键词",
    includeText: "青白江",
    priority: 100,
    districtCode: "510113",
  },
  {
    name: "都江堰关键词",
    includeText: "都江堰",
    priority: 100,
    districtCode: "510181",
  },
  {
    name: "天府新区关键词",
    includeText: "天府新区",
    priority: 100,
    districtCode: "TF_XQ",
  },
  {
    name: "龙泉驿关键词",
    includeText: "龙泉驿",
    priority: 200,
    districtCode: "510112",
  },
];
mappingRules.push({
  name: "市公司兜底关键词",
  includeText: "四川分公司/成都分公司/",
  excludeText: "支撑服务中心",
  priority: 10,
  districtCode: "510106",
});

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
  for (const [code, name, sortOrder] of districts) {
    await prisma.district.upsert({
      where: { code },
      create: { code, name, sortOrder, enabled: true },
      update: { name, sortOrder, enabled: true },
    });
  }
  await prisma.district.updateMany({
    where: { code: { notIn: districts.map(([code]) => code) } },
    data: { enabled: false, sortOrder: 999 },
  });
  for (const [code, name, sortOrder] of [["510116", "双流", 902]] as const) {
    await prisma.district.updateMany({
      where: { code },
      data: { name, sortOrder, enabled: false },
    });
  }

  for (const rule of mappingRules) {
    const district = await prisma.district.findUniqueOrThrow({
      where: { code: rule.districtCode },
    });
    const existing = await prisma.personnelDistrictRule.findFirst({
      where: {
        includeText: rule.includeText,
        excludeText: rule.excludeText ?? null,
        districtId: district.id,
      },
    });
    if (existing)
      await prisma.personnelDistrictRule.update({
        where: { id: existing.id },
        data: {
          name: rule.name,
          priority: rule.priority,
          enabled: true,
        },
      });
    else
      await prisma.personnelDistrictRule.create({
        data: {
          name: rule.name,
          includeText: rule.includeText,
          excludeText: rule.excludeText ?? null,
          priority: rule.priority,
          enabled: true,
          districtId: district.id,
        },
      });
  }

  const phone = process.env.BOOTSTRAP_ADMIN_PHONE;
  if (!phone || !/^1[3-9]\d{9}$/.test(phone))
    throw new Error(
      "BOOTSTRAP_ADMIN_PHONE must be a valid mainland China mobile number",
    );
  const password = initialPasswordFromPhone(phone);
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
  else if (!existingGrant.active)
    await prisma.roleGrant.update({
      where: { id: existingGrant.id },
      data: { active: true },
    });
}

main().finally(async () => prisma.$disconnect());
