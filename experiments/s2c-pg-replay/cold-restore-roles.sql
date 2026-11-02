-- Disposable cold-cluster recovery fixture. Provision role identities BEFORE
-- restoring the schema; no secrets or user data are restored by this file.
-- Run only in a fresh PostgreSQL 16+ test cluster.
BEGIN;
CREATE ROLE protocolia_s2c_owner NOLOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_runtime NOLOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_untrusted NOLOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_a_sandbox_login LOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_a_other_login LOGIN NOINHERIT;
CREATE ROLE protocolia_s2c_b_sandbox_login LOGIN NOINHERIT;
GRANT protocolia_s2c_runtime TO protocolia_s2c_a_sandbox_login;
GRANT protocolia_s2c_runtime TO protocolia_s2c_a_other_login;
GRANT protocolia_s2c_runtime TO protocolia_s2c_b_sandbox_login;
COMMIT;
