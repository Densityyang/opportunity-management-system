CREATE TYPE "PersonnelSourceProfile" AS ENUM ('FULL_DIRECTORY', 'CONTACT_ONLY');

ALTER TABLE "personnel"
  ADD COLUMN "source_profile" "PersonnelSourceProfile" NOT NULL DEFAULT 'FULL_DIRECTORY';

ALTER TABLE "personnel_imports"
  ADD COLUMN "source_profile" "PersonnelSourceProfile" NOT NULL DEFAULT 'FULL_DIRECTORY';

ALTER TABLE "districts"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "position_role_templates" (
  "position_id" UUID NOT NULL,
  "role" "RoleCode" NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "position_role_templates_pkey" PRIMARY KEY ("position_id", "role")
);

CREATE INDEX "position_role_templates_role_idx"
  ON "position_role_templates"("role");

ALTER TABLE "position_role_templates"
  ADD CONSTRAINT "position_role_templates_position_id_fkey"
  FOREIGN KEY ("position_id") REFERENCES "personnel_positions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "districts" ("id", "code", "name", "enabled", "sort_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), '510106', '金牛', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510108', '成华', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510105', '青羊', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510104', '锦江', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510107', '武侯', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GX_NAN', '高新南', true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'GX_XI', '高新西', true, 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'DB_XQ', '东部新区', true, 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510129', '大邑', true, 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510185', '简阳', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510121', '金堂', true, 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510114', '新都', true, 12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510115', '温江', true, 13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510117', '郫都', true, 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510182', '彭州', true, 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510184', '崇州', true, 16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510118', '新津', true, 17, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510183', '邛崃', true, 18, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510131', '蒲江', true, 19, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510113', '青白江', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510181', '都江堰', true, 21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "enabled" = true,
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "districts"
SET "name" = CASE "code"
      WHEN '510112' THEN '龙泉驿'
      WHEN '510116' THEN '双流'
      ELSE "name"
    END,
    "enabled" = false,
    "sort_order" = CASE "code"
      WHEN '510112' THEN 901
      WHEN '510116' THEN 902
      ELSE "sort_order"
    END,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN ('510112', '510116');

UPDATE "districts"
SET "enabled" = false,
    "sort_order" = CASE
      WHEN "sort_order" >= 900 THEN "sort_order"
      ELSE 999
    END,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "code" NOT IN (
  '510106', '510108', '510105', '510104', '510107', 'GX_NAN', 'GX_XI',
  'DB_XQ', '510129', '510185', '510121', '510114', '510115', '510117',
  '510182', '510184', '510118', '510183', '510131', '510113', '510181'
);

DO $$
DECLARE
  unscoped_reporters INTEGER;
  manager_districts INTEGER;
  sole_district UUID;
BEGIN
  SELECT COUNT(*) INTO unscoped_reporters
  FROM "role_grants"
  WHERE "role" = 'FIELD_REPORTER' AND "district_id" IS NULL;

  IF unscoped_reporters > 0 THEN
    SELECT COUNT(DISTINCT "district_id")
      INTO manager_districts
    FROM "role_grants"
    WHERE "role" = 'DISTRICT_MANAGER'
      AND "active" = true
      AND "district_id" IS NOT NULL;

    IF manager_districts <> 1 THEN
      RAISE EXCEPTION
        'Cannot infer district for % unscoped FIELD_REPORTER grants; configure exactly one active manager district before migration',
        unscoped_reporters;
    END IF;

    SELECT "district_id" INTO sole_district
    FROM "role_grants"
    WHERE "role" = 'DISTRICT_MANAGER'
      AND "active" = true
      AND "district_id" IS NOT NULL
    LIMIT 1;

    UPDATE "role_grants"
    SET "district_id" = sole_district,
        "updated_at" = CURRENT_TIMESTAMP
    WHERE "role" = 'FIELD_REPORTER' AND "district_id" IS NULL;
  END IF;
END $$;

ALTER TABLE "role_grants"
  ADD CONSTRAINT "role_grants_scope_check"
  CHECK (
    ("role" IN ('FIELD_REPORTER', 'DISTRICT_MANAGER', 'PERSONAL_HANDLER', 'ORGANIZATION_HANDLER') AND "district_id" IS NOT NULL)
    OR
    ("role" IN ('MUNICIPAL', 'SENIOR_MUNICIPAL_ADMIN', 'SYSTEM_ADMIN') AND "district_id" IS NULL)
  );

DROP TABLE "district_routing";
