CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "RoleCode" AS ENUM ('FIELD_REPORTER', 'DISTRICT_MANAGER', 'PERSONAL_HANDLER', 'ORGANIZATION_HANDLER', 'MUNICIPAL', 'SYSTEM_ADMIN');
CREATE TYPE "CustomerType" AS ENUM ('PERSONAL', 'ORGANIZATION');
CREATE TYPE "CustomerAttitude" AS ENUM ('URGENT', 'IMPORTANT', 'GENERAL', 'POTENTIAL');
CREATE TYPE "OpportunityState" AS ENUM ('PENDING_FIRST_REVIEW', 'RETURNED_TO_REPORTER', 'HANDLING', 'PAUSED', 'PENDING_FINAL_REVIEW', 'RETURNED_TO_HANDLER', 'CLOSED_SUCCESS', 'CLOSED_FAILURE');
CREATE TYPE "ResultKind" AS ENUM ('SUCCESS', 'FAILURE');
CREATE TYPE "SlaKind" AS ENUM ('FIRST_REVIEW', 'FINAL_REVIEW');
CREATE TYPE "SlaStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AudioStatus" AS ENUM ('ACTIVE', 'DELETED');
CREATE TYPE "RetentionAction" AS ENUM ('ANONYMIZE', 'DELETE');
CREATE TYPE "RetentionStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'DISMISSED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "phone_ciphertext" TEXT NOT NULL,
  "phone_iv" TEXT NOT NULL,
  "phone_tag" TEXT NOT NULL,
  "phone_blind_index" TEXT NOT NULL,
  "display_name" VARCHAR(80) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "must_change_password" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "users_phone_blind_index_key" UNIQUE ("phone_blind_index")
);

CREATE TABLE "password_credentials" (
  "user_id" UUID NOT NULL,
  "password_hash" TEXT NOT NULL,
  "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_credentials_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "user_agent" VARCHAR(500),
  "ip_address" VARCHAR(64),
  "revoked_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_token_hash_key" UNIQUE ("token_hash")
);

CREATE TABLE "districts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" VARCHAR(12) NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "districts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "districts_code_key" UNIQUE ("code"),
  CONSTRAINT "districts_name_key" UNIQUE ("name")
);

CREATE TABLE "role_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "role" "RoleCode" NOT NULL,
  "district_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "role_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "district_routing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "district_id" UUID NOT NULL,
  "manager_grant_id" UUID NOT NULL,
  "personal_handler_grant_id" UUID NOT NULL,
  "organization_handler_grant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "district_routing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "district_routing_district_id_key" UNIQUE ("district_id")
);

CREATE TABLE "opportunities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "serial_number" VARCHAR(32) NOT NULL,
  "reporter_id" UUID NOT NULL,
  "district_id" UUID NOT NULL,
  "customer_type" "CustomerType" NOT NULL,
  "attitude" "CustomerAttitude" NOT NULL,
  "state" "OpportunityState" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "reporter_phone_ciphertext" TEXT NOT NULL,
  "reporter_phone_iv" TEXT NOT NULL,
  "reporter_phone_tag" TEXT NOT NULL,
  "customer_contact_ciphertext" TEXT NOT NULL,
  "customer_contact_iv" TEXT NOT NULL,
  "customer_contact_tag" TEXT NOT NULL,
  "customer_contact_blind_index" TEXT NOT NULL,
  "specific_need_ciphertext" TEXT NOT NULL,
  "specific_need_iv" TEXT NOT NULL,
  "specific_need_tag" TEXT NOT NULL,
  "description_ciphertext" TEXT,
  "description_iv" TEXT,
  "description_tag" TEXT,
  "consent_at" TIMESTAMPTZ(3) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL,
  "paused_until" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunities_serial_number_key" UNIQUE ("serial_number")
);

CREATE TABLE "opportunity_revisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "revision_number" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "submitted_by_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "opportunity_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "opportunity_revisions_opportunity_id_revision_number_key" UNIQUE ("opportunity_id", "revision_number")
);

CREATE TABLE "assignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "handler_grant_id" UUID NOT NULL,
  "assigned_by_id" UUID NOT NULL,
  "reason_ciphertext" TEXT,
  "reason_iv" TEXT,
  "reason_tag" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "handling_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "kind" "ResultKind" NOT NULL,
  "success_name_ciphertext" TEXT,
  "success_name_iv" TEXT,
  "success_name_tag" TEXT,
  "success_name_search_tokens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "failure_reason_ciphertext" TEXT,
  "failure_reason_iv" TEXT,
  "failure_reason_tag" TEXT,
  "submitted_by_grant_id" UUID NOT NULL,
  "submitted_at" TIMESTAMPTZ(3) NOT NULL,
  "final_approved_at" TIMESTAMPTZ(3),
  CONSTRAINT "handling_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "handling_results_opportunity_id_key" UNIQUE ("opportunity_id"),
  CONSTRAINT "handling_results_payload_check" CHECK (
    ("kind" = 'SUCCESS' AND "success_name_ciphertext" IS NOT NULL AND "failure_reason_ciphertext" IS NULL)
    OR ("kind" = 'FAILURE' AND "success_name_ciphertext" IS NULL AND "failure_reason_ciphertext" IS NOT NULL)
  )
);

CREATE TABLE "workflow_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "event_type" VARCHAR(80) NOT NULL,
  "from_state" "OpportunityState",
  "to_state" "OpportunityState" NOT NULL,
  "actor_user_id" UUID,
  "actor_grant_id" UUID,
  "actor_role" "RoleCode",
  "note_ciphertext" TEXT,
  "note_iv" TEXT,
  "note_tag" TEXT,
  "metadata" JSONB,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sla_rounds" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "kind" "SlaKind" NOT NULL,
  "round_number" INTEGER NOT NULL,
  "status" "SlaStatus" NOT NULL DEFAULT 'ACTIVE',
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "reminder_at" TIMESTAMPTZ(3) NOT NULL,
  "deadline_at" TIMESTAMPTZ(3) NOT NULL,
  "reminder_sent_at" TIMESTAMPTZ(3),
  "overdue_marked_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "sla_rounds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sla_rounds_opportunity_id_kind_round_number_key" UNIQUE ("opportunity_id", "kind", "round_number")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipient_user_id" UUID NOT NULL,
  "recipient_grant_id" UUID,
  "opportunity_id" UUID,
  "type" VARCHAR(80) NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "read_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audio_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "storage_key" TEXT NOT NULL,
  "encryption_iv" TEXT NOT NULL,
  "encryption_tag" TEXT NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "AudioStatus" NOT NULL DEFAULT 'ACTIVE',
  "delete_after" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audio_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audio_records_opportunity_id_key" UNIQUE ("opportunity_id"),
  CONSTRAINT "audio_records_storage_key_key" UNIQUE ("storage_key"),
  CONSTRAINT "audio_records_limits_check" CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880 AND "duration_ms" > 0 AND "duration_ms" <= 30500)
);

CREATE TABLE "idempotency_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope" VARCHAR(120) NOT NULL,
  "key" VARCHAR(160) NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_status" INTEGER NOT NULL,
  "response_body" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "idempotency_records_scope_key_key" UNIQUE ("scope", "key")
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "type" VARCHAR(100) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reauth_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reauth_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reauth_tokens_token_hash_key" UNIQUE ("token_hash")
);

CREATE TABLE "export_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "export_type" VARCHAR(80) NOT NULL,
  "filters" JSONB NOT NULL,
  "row_count" INTEGER NOT NULL,
  "started_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  "success" BOOLEAN NOT NULL DEFAULT false,
  "error_code" VARCHAR(80),
  CONSTRAINT "export_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "access_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "opportunity_id" UUID,
  "action" VARCHAR(80) NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "access_audits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "retention_candidates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "opportunity_id" UUID NOT NULL,
  "eligible_at" TIMESTAMPTZ(3) NOT NULL,
  "suggested_action" "RetentionAction" NOT NULL,
  "status" "RetentionStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "retention_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "retention_candidates_opportunity_id_key" UNIQUE ("opportunity_id")
);

CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");
CREATE INDEX "role_grants_user_id_active_idx" ON "role_grants"("user_id", "active");
CREATE INDEX "role_grants_role_district_id_active_idx" ON "role_grants"("role", "district_id", "active");
CREATE INDEX "opportunities_reporter_id_submitted_at_idx" ON "opportunities"("reporter_id", "submitted_at" DESC);
CREATE INDEX "opportunities_district_id_state_updated_at_idx" ON "opportunities"("district_id", "state", "updated_at" DESC);
CREATE INDEX "opportunities_state_closed_at_idx" ON "opportunities"("state", "closed_at" DESC);
CREATE INDEX "opportunities_customer_contact_blind_index_idx" ON "opportunities"("customer_contact_blind_index");
CREATE INDEX "assignments_opportunity_id_active_idx" ON "assignments"("opportunity_id", "active");
CREATE INDEX "assignments_handler_grant_id_active_idx" ON "assignments"("handler_grant_id", "active");
CREATE INDEX "handling_results_kind_submitted_at_idx" ON "handling_results"("kind", "submitted_at" DESC);
CREATE INDEX "handling_results_success_name_search_tokens_idx" ON "handling_results" USING GIN ("success_name_search_tokens");
CREATE INDEX "workflow_events_opportunity_id_occurred_at_idx" ON "workflow_events"("opportunity_id", "occurred_at");
CREATE INDEX "sla_rounds_status_reminder_at_idx" ON "sla_rounds"("status", "reminder_at");
CREATE INDEX "sla_rounds_status_deadline_at_idx" ON "sla_rounds"("status", "deadline_at");
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at" DESC);
CREATE INDEX "audio_records_status_delete_after_idx" ON "audio_records"("status", "delete_after");
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records"("expires_at");
CREATE INDEX "outbox_events_processed_at_available_at_idx" ON "outbox_events"("processed_at", "available_at");
CREATE INDEX "reauth_tokens_user_id_expires_at_idx" ON "reauth_tokens"("user_id", "expires_at");
CREATE INDEX "export_audits_user_id_started_at_idx" ON "export_audits"("user_id", "started_at" DESC);
CREATE INDEX "access_audits_user_id_created_at_idx" ON "access_audits"("user_id", "created_at" DESC);
CREATE INDEX "access_audits_opportunity_id_created_at_idx" ON "access_audits"("opportunity_id", "created_at" DESC);
CREATE INDEX "retention_candidates_status_eligible_at_idx" ON "retention_candidates"("status", "eligible_at");

ALTER TABLE "password_credentials" ADD CONSTRAINT "password_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_grants" ADD CONSTRAINT "role_grants_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "district_routing" ADD CONSTRAINT "district_routing_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "district_routing" ADD CONSTRAINT "district_routing_manager_grant_id_fkey" FOREIGN KEY ("manager_grant_id") REFERENCES "role_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "district_routing" ADD CONSTRAINT "district_routing_personal_handler_grant_id_fkey" FOREIGN KEY ("personal_handler_grant_id") REFERENCES "role_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "district_routing" ADD CONSTRAINT "district_routing_organization_handler_grant_id_fkey" FOREIGN KEY ("organization_handler_grant_id") REFERENCES "role_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "opportunity_revisions" ADD CONSTRAINT "opportunity_revisions_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_handler_grant_id_fkey" FOREIGN KEY ("handler_grant_id") REFERENCES "role_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "handling_results" ADD CONSTRAINT "handling_results_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "handling_results" ADD CONSTRAINT "handling_results_submitted_by_grant_id_fkey" FOREIGN KEY ("submitted_by_grant_id") REFERENCES "role_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sla_rounds" ADD CONSTRAINT "sla_rounds_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_grant_id_fkey" FOREIGN KEY ("recipient_grant_id") REFERENCES "role_grants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audio_records" ADD CONSTRAINT "audio_records_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reauth_tokens" ADD CONSTRAINT "reauth_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_audits" ADD CONSTRAINT "export_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "access_audits" ADD CONSTRAINT "access_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_candidates" ADD CONSTRAINT "retention_candidates_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "role_grants_active_scope_key"
  ON "role_grants"("user_id", "role", COALESCE("district_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "active" = true;

CREATE UNIQUE INDEX "assignments_one_active_per_opportunity"
  ON "assignments"("opportunity_id") WHERE "active" = true;
