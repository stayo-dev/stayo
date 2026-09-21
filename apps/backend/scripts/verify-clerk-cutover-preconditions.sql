-- Clerk cutover (ADR-204) — Phase 1 production pre-checks.
--
-- READ-ONLY. Nothing here writes. Run in the Supabase SQL editor of the
-- PRODUCTION project (qgfyfbdccjnibdhhvnsr — confirm with
-- `curl -s https://api.yourstayo.com/api/health | jq .auth.supabase.project_ref`
-- before running, never trust a local .env to name production).
--
-- Deployment is BLOCKED unless check 1 returns a non-null table name.

-- 1. Migration 081. getSession() queries `users` on every Supabase/legacy
--    request; without this table every authenticated request 500s (P2021).
SELECT to_regclass('public.users') AS users_table;   -- must NOT be null

-- 2. Column shape of the identity anchor (only if check 1 passed).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users'
ORDER BY ordinal_position;

-- 3. The unique indexes the link depends on: clerk_user_id and profile_id.
--    Without them, "one login per profile" is timing, not a guarantee.
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'users';

-- 4. Population counts.
SELECT
  (SELECT count(*) FROM profiles)                                        AS profiles_total,
  (SELECT count(*) FROM profiles WHERE is_active)                        AS profiles_active,
  (SELECT count(*) FROM profiles WHERE auth_user_id IS NOT NULL)         AS supabase_linked,
  (SELECT count(*) FROM profiles WHERE password_hash IS NOT NULL)        AS with_local_hash,
  (SELECT count(*) FROM profiles WHERE email LIKE '%@hms.temp')          AS placeholder_email,
  (SELECT count(*) FROM users)                                           AS clerk_logins_total,
  (SELECT count(*) FROM users WHERE profile_id IS NOT NULL)              AS clerk_logins_linked,
  (SELECT count(*) FROM users WHERE profile_id IS NOT NULL AND is_active) AS clerk_logins_linked_active;

-- 5. Accounts that would still be on the Supabase path after deploy, by role.
--    These are the people the bulk migration (step 3) has to move.
SELECT p.role,
       count(*)                                          AS unmoved,
       count(*) FILTER (WHERE p.password_hash IS NOT NULL) AS movable_by_digest,
       count(*) FILTER (WHERE p.password_hash IS NULL)     AS no_password_google_or_invited
FROM profiles p
LEFT JOIN users u ON u.profile_id = p.id
WHERE u.id IS NULL AND p.is_active
GROUP BY p.role
ORDER BY p.role;

-- 6. Bcrypt-importability of the hashes we intend to hand Clerk.
--    Anything not matching cannot be imported and becomes CREATE_NO_PASSWORD
--    (that person signs in with Google or resets).
SELECT count(*) FILTER (WHERE password_hash ~ '^\$2[aby]\$\d{2}\$.{53}$') AS importable_bcrypt,
       count(*) FILTER (WHERE password_hash IS NOT NULL
                          AND password_hash !~ '^\$2[aby]\$\d{2}\$.{53}$') AS not_importable
FROM profiles
WHERE password_hash IS NOT NULL;

-- 7. Links made by the pre-ADR-204 webhook (email matching). Each needs a
--    human to confirm the Clerk user carries external_id = profiles.id.
--    Cross-check the ids this returns against Clerk.
SELECT u.clerk_user_id, u.profile_id, p.role, p.is_active
FROM users u
JOIN profiles p ON p.id = u.profile_id
ORDER BY u.created_at;

-- 8. Duplicate-link sanity: no profile may hold two logins, no login two
--    profiles. Both should return zero rows.
SELECT profile_id, count(*) FROM users WHERE profile_id IS NOT NULL
GROUP BY profile_id HAVING count(*) > 1;
SELECT clerk_user_id, count(*) FROM users
GROUP BY clerk_user_id HAVING count(*) > 1;
