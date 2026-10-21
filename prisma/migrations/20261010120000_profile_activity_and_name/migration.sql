-- Profile settings + activity filenames (D4, D5).
--
-- Additive and nullable, so it applies without downtime and older application
-- code (which never selects these columns) keeps working unchanged.
--
--   users.name                 editable display name ("Username"). Supabase Auth
--                              owns the credential; this is the product-side
--                              name the profile panel lets the owner change.
--   feature_usage_events.file_name   the processed file's name, stored on the
--                              success-only per-user row. Owner-visible only:
--                              the admin analytics query deliberately never
--                              selects it (D7), so the filename privacy boundary
--                              is enforced in the read path, not by a separate
--                              table.
ALTER TABLE "users" ADD COLUMN "name" TEXT;

ALTER TABLE "feature_usage_events" ADD COLUMN "file_name" TEXT;
