#!/usr/bin/env bash
# Red-team probe for the auth surface (ADR-204 + C1/C2/C3), Phase 3 of the
# verification gate. Unauthenticated shape only — the authenticated cases
# (cross-owner reads, admin-as-owner, ID tampering) need two real accounts and
# must be run by hand or extended with real bearer tokens.
#
# Usage:  BASE=https://<preview-or-prod> bash scripts/redteam-auth-probe.sh
#         OWNER_JWT=... TENANT_JWT=... SUPABASE_JWT=...  (optional, for the
#         authenticated probes below)
#
# Reports PASS (attack refused) / FAIL (attack succeeded) / SKIP (no token).
# A FAIL is a real finding; investigate before merge.
set -u
BASE="${BASE:?set BASE to the deploy under test}"
pass=0; fail=0; skip=0
say(){ printf '%-6s %s\n' "$1" "$2"; case $1 in PASS)pass=$((pass+1));; FAIL)fail=$((fail+1));; SKIP)skip=$((skip+1));; esac; }

code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

# --- unauthenticated: every protected route must refuse a request with no token
for path in /api/profiles/00000000-0000-0000-0000-000000000000 \
            /api/admin/finance/reconciliation/issues \
            /api/admin/finance/reconciliation/scan \
            /api/owner/subscription \
            /api/tenants/me/dues ; do
  c=$(code "$BASE$path")
  [ "$c" = 401 ] && say PASS "no-token $path -> 401" || say FAIL "no-token $path -> $c (expected 401)"
done

# --- a garbage bearer must not be honoured anywhere
c=$(code -H "Authorization: Bearer not.a.jwt" "$BASE/api/owner/subscription")
[ "$c" = 401 ] && say PASS "garbage bearer -> 401" || say FAIL "garbage bearer -> $c"

# --- a stale Supabase JWT for a MIGRATED account must be refused (getSession
#     rejects any Supabase token once the profile has a Clerk login).
if [ -n "${SUPABASE_JWT:-}" ]; then
  c=$(code -H "Authorization: Bearer $SUPABASE_JWT" "$BASE/api/auth/me")
  [ "$c" = 401 ] && say PASS "supabase JWT (migrated) -> 401" || say FAIL "supabase JWT -> $c (expected 401 post-migration)"
else say SKIP "supabase JWT probe (set SUPABASE_JWT)"; fi

# --- C1: an OWNER reading another profile. Needs a real owner token and a
#     victim profile id that is not theirs.
if [ -n "${OWNER_JWT:-}" ] && [ -n "${VICTIM_PROFILE_ID:-}" ]; then
  c=$(code -H "Authorization: Bearer $OWNER_JWT" "$BASE/api/profiles/$VICTIM_PROFILE_ID")
  { [ "$c" = 403 ] || [ "$c" = 404 ]; } && say PASS "C1 cross-owner read -> $c" || say FAIL "C1 cross-owner read -> $c (expected 403/404)"
else say SKIP "C1 cross-owner read (set OWNER_JWT, VICTIM_PROFILE_ID)"; fi

# --- C2: OWNER hitting an admin route.
if [ -n "${OWNER_JWT:-}" ]; then
  c=$(code -H "Authorization: Bearer $OWNER_JWT" "$BASE/api/admin/finance/reconciliation/issues")
  [ "$c" = 403 ] && say PASS "C2 owner->admin -> 403" || say FAIL "C2 owner->admin -> $c (expected 403)"
else say SKIP "C2 owner->admin (set OWNER_JWT)"; fi

echo "----"
echo "PASS=$pass FAIL=$fail SKIP=$skip"
[ "$fail" -eq 0 ]
