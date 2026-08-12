CREATE TYPE "PersonnelImportMode" AS ENUM ('UPSERT', 'SNAPSHOT');
CREATE TYPE "PersonnelImportStatus" AS ENUM ('APPLIED', 'FAILED');

CREATE TABLE "personnel" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "personnel_code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "personal_phone_ciphertext" TEXT,
  "personal_phone_iv" TEXT,
  "personal_phone_tag" TEXT,
  "personal_phone_blind_index" TEXT,
  "work_phone_ciphertext" TEXT,
  "work_phone_iv" TEXT,
  "work_phone_tag" TEXT,
  "work_phone_blind_index" TEXT,
  "organization_path" VARCHAR(240),
  "first_level_organization" VARCHAR(120),
  "second_level_organization" VARCHAR(120),
  "third_level_organization" VARCHAR(120),
  "position_name" VARCHAR(120),
  "business_line" VARCHAR(80),
  "position_category" VARCHAR(80),
  "standard_position" VARCHAR(120),
  "position_tags" VARCHAR(500),
  "employment_status" VARCHAR(80),
  "personnel_type" VARCHAR(100),
  "contract_type" VARCHAR(100),
  "cooperative_enterprise" VARCHAR(160),
  "cooperative_employment_type" VARCHAR(100),
  "cooperative_employment_source" VARCHAR(100),
  "employment_management" VARCHAR(100),
  "compensation_type" VARCHAR(100),
  "settlement_project" VARCHAR(160),
  "notes" VARCHAR(500),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "source_file_name" VARCHAR(240),
  "source_row_number" INTEGER,
  "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_personnel_code_key" UNIQUE ("personnel_code")
);

CREATE TABLE "personnel_positions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(40) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_positions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "personnel_positions_code_key" UNIQUE ("code"),
  CONSTRAINT "personnel_positions_name_key" UNIQUE ("name")
);

CREATE TABLE "personnel_imports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "file_name" VARCHAR(240) NOT NULL,
  "mode" "PersonnelImportMode" NOT NULL,
  "status" "PersonnelImportStatus" NOT NULL DEFAULT 'APPLIED',
  "total_rows" INTEGER NOT NULL,
  "created_rows" INTEGER NOT NULL,
  "updated_rows" INTEGER NOT NULL,
  "deactivated_rows" INTEGER NOT NULL,
  "skipped_rows" INTEGER NOT NULL,
  "accounts_created" INTEGER NOT NULL,
  "accounts_linked" INTEGER NOT NULL,
  "warnings" JSONB,
  "actor_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "personnel_imports_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "users" ADD COLUMN "personnel_id" UUID;
CREATE UNIQUE INDEX "users_personnel_id_key" ON "users"("personnel_id");
CREATE INDEX "personnel_name_idx" ON "personnel"("name");
CREATE INDEX "personnel_active_updated_at_idx" ON "personnel"("active", "updated_at" DESC);
CREATE INDEX "personnel_personal_phone_blind_index_idx" ON "personnel"("personal_phone_blind_index");
CREATE INDEX "personnel_work_phone_blind_index_idx" ON "personnel"("work_phone_blind_index");
CREATE INDEX "personnel_imports_created_at_idx" ON "personnel_imports"("created_at" DESC);

ALTER TABLE "users" ADD CONSTRAINT "users_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "personnel_imports" ADD CONSTRAINT "personnel_imports_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
