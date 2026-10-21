-- Reset the application schema. Auth stays in auth.users (Supabase GoTrue).
-- These objects belonged to the hand-written SQL that Prisma replaces.

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'touch_usage_plan_timestamp',
        'is_platform_admin',
        'promote_allowlisted_admin',
        'resolve_usage_plan',
        'claim_anon_usage',
        'consume_tool_usage',
        'usage_snapshot',
        'admin_list_plans',
        'admin_upsert_plan',
        'admin_assign_plan',
        'admin_list_tool_controls',
        'admin_reset_tool_usage',
        'admin_update_tool_control',
        'list_tool_availability',
        '_usage_window_count',
        '_usage_payload'
      )
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || fn.signature || ' CASCADE';
  END LOOP;
END $$;

DROP TABLE IF EXISTS public.usage_plan_assignments CASCADE;
DROP TABLE IF EXISTS public.usage_events CASCADE;
DROP TABLE IF EXISTS public.usage_plans CASCADE;
DROP TABLE IF EXISTS public.usage_admin_emails CASCADE;
DROP TABLE IF EXISTS public.tool_controls CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.usages CASCADE;
DROP TABLE IF EXISTS public.tools CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;
DROP TYPE IF EXISTS public.usage_period CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "usage_period" AS ENUM ('day', 'week');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "role" TEXT NOT NULL DEFAULT 'User',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tools" (
    "tool_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "guest_limit" INTEGER NOT NULL,
    "member_limit" INTEGER NOT NULL,
    "period" "usage_period" NOT NULL DEFAULT 'day',
    "period_hours" INTEGER NOT NULL DEFAULT 24,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tools_pkey" PRIMARY KEY ("tool_id")
);

-- CreateTable
CREATE TABLE "usages" (
    "id" UUID NOT NULL,
    "anon_id" UUID NOT NULL,
    "user_id" UUID,
    "tool_id" TEXT NOT NULL,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usages_request_id_key" ON "usages"("request_id");

-- CreateIndex
CREATE INDEX "usages_tool_id_created_at_idx" ON "usages"("tool_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "usages_user_id_created_at_idx" ON "usages"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "usages_anon_id_created_at_idx" ON "usages"("anon_id", "created_at" DESC);
