import assert from "node:assert/strict";
import test from "node:test";
import { PersonnelSourceProfile } from "../../generated/prisma/client";
import { PersonnelBatchService } from "./personnel-batch.service";

type Resolution = {
  districtId: string | null;
  ruleId: string | null;
  status: string;
  reason: string | null;
};

const service = Object.create(PersonnelBatchService.prototype) as PersonnelBatchService;
const resolve = (
  service as unknown as {
    resolve: (...args: unknown[]) => Resolution;
  }
).resolve.bind(service);

const district = (id: string, name: string, enabled = true) => ({
  id,
  name,
  enabled,
});

const person = (sourceProfile: PersonnelSourceProfile, organizationPath: string | null) => ({
  id: "person-1",
  personnelCode: "P-1",
  name: "测试人员",
  personalPhoneCiphertext: null,
  personalPhoneIv: null,
  personalPhoneTag: null,
  personalPhoneBlindIndex: null,
  workPhoneCiphertext: null,
  workPhoneIv: null,
  workPhoneTag: null,
  workPhoneBlindIndex: null,
  organizationPath,
  firstLevelOrganization: null,
  secondLevelOrganization: null,
  thirdLevelOrganization: null,
  positionName: null,
  sourceProfile,
  active: true,
  updatedAt: new Date(),
  user: null,
});

test("龙泉驿规则优先于同时出现的天府新区", () => {
  const result = resolve(
    person(PersonnelSourceProfile.FULL_DIRECTORY, "四川分公司/成都分公司/天府新区支撑服务中心/龙泉驿班组"),
    [
      {
        id: "tianfu",
        name: "天府新区",
        includeText: "天府新区",
        excludeText: null,
        priority: 100,
        enabled: true,
        districtId: "district-tianfu",
        district: district("district-tianfu", "天府新区"),
        updatedAt: new Date(),
      },
      {
        id: "longquanyi",
        name: "龙泉驿",
        includeText: "龙泉驿",
        excludeText: null,
        priority: 200,
        enabled: true,
        districtId: "district-longquanyi",
        district: district("district-longquanyi", "龙泉驿"),
        updatedAt: new Date(),
      },
    ],
    new Map(),
  );
  assert.deepEqual(result, {
    districtId: "district-longquanyi",
    ruleId: "longquanyi",
    status: "MAPPED",
    reason: null,
  });
});

test("联系人简表固定归金牛且不依赖组织规则", () => {
  const result = resolve(
    person(PersonnelSourceProfile.CONTACT_ONLY, null),
    [],
    new Map([["510106", district("district-jinniu", "金牛")]]),
  );
  assert.deepEqual(result, {
    districtId: "district-jinniu",
    ruleId: null,
    status: "MAPPED",
    reason: null,
  });
});

test("同优先级命中不同区县时返回歧义", () => {
  const result = resolve(
    person(PersonnelSourceProfile.FULL_DIRECTORY, "四川分公司/成都分公司/冲突组织"),
    [
      {
        id: "one",
        name: "规则一",
        includeText: "冲突",
        excludeText: null,
        priority: 100,
        enabled: true,
        districtId: "district-one",
        district: district("district-one", "金牛"),
        updatedAt: new Date(),
      },
      {
        id: "two",
        name: "规则二",
        includeText: "冲突",
        excludeText: null,
        priority: 100,
        enabled: true,
        districtId: "district-two",
        district: district("district-two", "成华"),
        updatedAt: new Date(),
      },
    ],
    new Map(),
  );
  assert.equal(result.status, "AMBIGUOUS");
});
