import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SubmitOpportunityDto } from "./opportunity.dto";

const base = {
  customerType: "PERSONAL",
  districtId: "123e4567-e89b-12d3-a456-426614174000",
  customerContact: "13800000000",
  attitude: "GENERAL",
  consentConfirmed: true,
};

test("specific needs accepts at most two fixed menu options", async () => {
  const dto = plainToInstance(SubmitOpportunityDto, {
    ...base,
    specificNeeds: ["其他需求", "想新装、升级宽带或专线"],
  });
  assert.deepEqual(await validate(dto), []);

  const tooMany = plainToInstance(SubmitOpportunityDto, {
    ...base,
    specificNeeds: [
      "其他需求",
      "想新装、升级宽带或专线",
      "家里、商铺或办公室网络不好",
    ],
  });
  assert.ok((await validate(tooMany)).length > 0);
});

test("specific needs rejects free-text values", async () => {
  const dto = plainToInstance(SubmitOpportunityDto, {
    ...base,
    specificNeeds: ["智慧园区方案"],
  });
  assert.ok((await validate(dto)).length > 0);
});
