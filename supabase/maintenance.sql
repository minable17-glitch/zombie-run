-- Enable Supabase Cron (pg_cron) before running this file as postgres.
-- Reusing this job name updates its schedule instead of creating duplicates.
select cron.schedule('zr-expire-rooms', '*/15 * * * *',
  'select public.zr_expire_rooms();');
