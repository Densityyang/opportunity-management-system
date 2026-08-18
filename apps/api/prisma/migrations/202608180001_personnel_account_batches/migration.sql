CREATE TYPE "PersonnelAccountBatchStatus" AS ENUM (
  'PREVIEWED',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'EXPIRED'
);

CREATE TYPE "PersonnelAccountBatchItemStatus" AS ENUM (
  'ELIGIBLE',
  'CREATED',
  'SKIPPED_EXISTING',
  'SKIPPED_INACTIVE',
  'SKIPPED_NO_PHONE',
  'SKIPPED_UNMAPPED',
  'SKIPPED_AMBIGUOUS',
  'FAILED'
);

CREATE TABLE "personnel_district_rules" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "include_text" VARCHAR(160) NOT NULL,
  "exclude_text" VARCHAR(160),
  "priority" INTEGER NOT NULL DEFAULT 100,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "district_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_district_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personnel_district_rules_enabled_priority_idx"
  ON "personnel_district_rules"("enabled", "priority");

ALTER TABLE "personnel_district_rules"
  ADD CONSTRAINT "personnel_district_rules_district_id_fkey"
  FOREIGN KEY ("district_id") REFERENCES "districts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "personnel_account_batches" (
  "id" UUID NOT NULL,
  "search" VARCHAR(240),
  "status" "PersonnelAccountBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
  "mapping_fingerprint" VARCHAR(128) NOT NULL,
  "total_rows" INTEGER NOT NULL,
  "eligible_rows" INTEGER NOT NULL,
  "created_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_existing_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_inactive_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_no_phone_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_unmapped_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_ambiguous_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "personnel_account_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personnel_account_batches_actor_user_id_created_at_idx"
  ON "personnel_account_batches"("actor_user_id", "created_at" DESC);
CREATE INDEX "personnel_account_batches_status_created_at_idx"
  ON "personnel_account_batches"("status", "created_at" DESC);

ALTER TABLE "personnel_account_batches"
  ADD CONSTRAINT "personnel_account_batches_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "personnel_account_batch_items" (
  "id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "personnel_id" UUID NOT NULL,
  "district_id" UUID,
  "rule_id" UUID,
  "status" "PersonnelAccountBatchItemStatus" NOT NULL DEFAULT 'ELIGIBLE',
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_account_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personnel_account_batch_items_batch_id_personnel_id_key"
  ON "personnel_account_batch_items"("batch_id", "personnel_id");
CREATE INDEX "personnel_account_batch_items_batch_id_status_idx"
  ON "personnel_account_batch_items"("batch_id", "status");
CREATE INDEX "personnel_account_batch_items_personnel_id_status_idx"
  ON "personnel_account_batch_items"("personnel_id", "status");

ALTER TABLE "personnel_account_batch_items"
  ADD CONSTRAINT "personnel_account_batch_items_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "personnel_account_batches"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "personnel_account_batch_items_personnel_id_fkey"
  FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "personnel_account_batch_items_district_id_fkey"
  FOREIGN KEY ("district_id") REFERENCES "districts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "personnel_account_batch_items_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "personnel_district_rules"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "districts" ("id", "code", "name", "enabled", "sort_order", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'TF_XQ', '天府新区', true, 22, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), '510112', '龙泉驿', true, 23, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "enabled" = true,
  "sort_order" = EXCLUDED."sort_order",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "personnel_district_rules"
  ("id", "name", "include_text", "exclude_text", "priority", "enabled", "district_id")
SELECT gen_random_uuid(), source.name, source.include_text, source.exclude_text,
       source.priority, true, district."id"
FROM (VALUES
  ('金牛关键词', '金牛', NULL, 100, '510106'),
  ('成华关键词', '成华', NULL, 100, '510108'),
  ('青羊关键词', '青羊', NULL, 100, '510105'),
  ('锦江关键词', '锦江', NULL, 100, '510104'),
  ('武侯关键词', '武侯', NULL, 100, '510107'),
  ('高新南关键词', '高新南', NULL, 100, 'GX_NAN'),
  ('高新西关键词', '高新西', NULL, 100, 'GX_XI'),
  ('东部新区关键词', '东部新区', NULL, 100, 'DB_XQ'),
  ('大邑关键词', '大邑', NULL, 100, '510129'),
  ('简阳关键词', '简阳', NULL, 100, '510185'),
  ('金堂关键词', '金堂', NULL, 100, '510121'),
  ('新都关键词', '新都', NULL, 100, '510114'),
  ('温江关键词', '温江', NULL, 100, '510115'),
  ('郫都关键词', '郫都', NULL, 100, '510117'),
  ('郫县兼容关键词', '郫县', NULL, 100, '510117'),
  ('彭州关键词', '彭州', NULL, 100, '510182'),
  ('崇州关键词', '崇州', NULL, 100, '510184'),
  ('新津关键词', '新津', NULL, 100, '510118'),
  ('邛崃关键词', '邛崃', NULL, 100, '510183'),
  ('蒲江关键词', '蒲江', NULL, 100, '510131'),
  ('青白江关键词', '青白江', NULL, 100, '510113'),
  ('都江堰关键词', '都江堰', NULL, 100, '510181'),
  ('天府新区关键词', '天府新区', NULL, 100, 'TF_XQ'),
  ('龙泉驿关键词', '龙泉驿', NULL, 200, '510112'),
  ('市公司兜底关键词', '四川分公司/成都分公司/', '支撑服务中心', 10, '510106')
) AS source(name, include_text, exclude_text, priority, code)
JOIN "districts" district ON district."code" = source.code;
