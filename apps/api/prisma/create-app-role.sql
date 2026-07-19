-- Run once (as the Neon owner role) to create the least-privilege role the
-- application actually connects as. This is NOT optional: Neon's default
-- owner role is granted BYPASSRLS, which makes Postgres skip RLS checks
-- entirely for that role regardless of any policy or FORCE ROW LEVEL
-- SECURITY setting - see prisma/rls.sql's header comment. Migrations
-- (prisma migrate, prisma db execute) keep using the owner role's
-- DATABASE_URL/DIRECT_URL; only the running API's DATABASE_URL should point
-- at this role.
CREATE ROLE zaroda_app WITH LOGIN PASSWORD 'REPLACE_ME' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO zaroda_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO zaroda_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO zaroda_app;
-- So future `prisma migrate dev` tables are usable by zaroda_app without
-- re-running this file - run as the same owner role that runs migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO zaroda_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO zaroda_app;
