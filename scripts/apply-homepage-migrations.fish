#!/usr/bin/env fish
#
# Applies the two migrations the public homepage needs (ADR-223):
#
#   086_coverage_requests.sql        — the supply-request table
#   087_lead_acquisition_sources.sql — DISCOVER_DEMAND + STUDENT_REFERRAL
#   088_homepage_features.sql        — the admin-curated homepage line-up
#
# Usage, from the repo root:
#
#   ./scripts/apply-homepage-migrations.fish                 # dry run, shows the plan
#   ./scripts/apply-homepage-migrations.fish --apply         # uses DATABASE_URL from .env
#   ./scripts/apply-homepage-migrations.fish --apply "<url>" # explicit connection string
#
# Both migrations are idempotent, so re-running is safe.
#
# NOTE: the repo-root .env points at PRODUCTION. The script prints the host and
# database it is about to touch and asks you to type "yes" before writing.

set -l repo_root (dirname (status --current-filename))/..
set -l migrations $repo_root/migrations/086_coverage_requests.sql $repo_root/migrations/087_lead_acquisition_sources.sql $repo_root/migrations/088_homepage_features.sql

set -l apply 0
set -l url ""
for arg in $argv
    switch $arg
        case --apply
            set apply 1
        case '*'
            set url $arg
    end
end

for file in $migrations
    if not test -f $file
        echo "✗ missing: $file"
        exit 1
    end
end

# Reads one key out of .env without sourcing it: .env holds secrets we do not
# want exported into this shell, and the values contain characters fish would
# otherwise try to interpret.
function __env_value -a file key
    grep -m1 "^$key=" $file | string replace -r "^$key=" '' | string trim -c '"' | string trim -c "'"
end

# Session mode (5432) from transaction mode (6543). Transaction pooling wraps
# every statement in a transaction, and `ALTER TYPE … ADD VALUE` cannot run
# inside one; session mode behaves like a direct connection, and unlike the
# direct host it has IPv4 records.
function __session_mode -a url
    if test -z "$url"
        return
    end
    echo $url | string replace ':6543/' ':5432/' | string replace -r '[?&]pgbouncer=true' ''
end

function __works -a url
    test -n "$url"; or return 1
    PGCONNECT_TIMEOUT=8 psql "$url" -tAc 'select 1' >/dev/null 2>&1
end

if test -z "$url"
    # .env is gitignored, so it lives in whichever checkout you actually work
    # in — not necessarily the one this script was checked out into. Look in
    # this tree first, then in the main checkout when this is a git worktree.
    set -l env_file ""
    if test -f $repo_root/.env
        set env_file $repo_root/.env
    else
        set -l common (git -C $repo_root rev-parse --git-common-dir 2>/dev/null)
        if test -n "$common"
            set -l main_root (dirname (realpath $common))
            if test -f $main_root/.env
                set env_file $main_root/.env
            end
        end
    end

    if test -z "$env_file"
        echo "✗ no .env found, and no connection string given."
        echo "  Pass one explicitly:"
        echo "    "(status --current-filename)" --apply \"postgresql://…\""
        exit 1
    end

    echo "Env    : $env_file"

    set -l direct (__env_value $env_file DIRECT_URL)
    set -l pooled (__env_value $env_file DATABASE_URL)
    set -l session (__session_mode $pooled)

    # In preference order, with the reason each is or is not usable. DIRECT_URL
    # is the right answer where it resolves, but Supabase's direct host is
    # IPv6-only on many projects, so it is probed rather than assumed.
    echo "Probing connections…"
    if __works $direct
        set url $direct
        set -g chosen "DIRECT_URL (direct host, session semantics)"
    else if __works $session
        set url $session
        set -g chosen "DATABASE_URL in session mode (pooler :5432) — DIRECT_URL did not connect"
    else if __works $pooled
        set url $pooled
        set -g chosen "DATABASE_URL as-is (pooler :6543) — nothing better connected"
    else
        echo "✗ none of DIRECT_URL, the session-mode pooler, or DATABASE_URL could connect."
        echo "  Check the network, and that the Supabase project is running."
        exit 1
    end
    echo "Using  : $chosen"
end

if test -z "$url"
    echo "✗ DATABASE_URL is empty."
    exit 1
end

# Show where this is going without printing the password.
set -l target (string replace -r '^postgres(ql)?://[^@]*@' '' -- $url)
echo "Target : $target"
if string match -q '*pgbouncer=true*' -- $url; or string match -q '*:6543/*' -- $url
    echo
    echo "⚠  That is the pgbouncer pooler. Migrations should run on the direct"
    echo "   connection (db.<ref>.supabase.co:5432) — ALTER TYPE … ADD VALUE"
    echo "   cannot run inside a transaction block, and transaction pooling puts"
    echo "   every statement in one. Use DIRECT_URL, or pass it explicitly."
    echo
end
echo "Files  :"
for file in $migrations
    echo "         "(basename $file)
end
echo

if test $apply -eq 0
    echo "Dry run. Nothing was changed."
    echo "Re-run with --apply to execute."
    exit 0
end

read -l -P "Type 'yes' to apply these to the database above: " confirm
if test "$confirm" != yes
    echo "Aborted. Nothing was changed."
    exit 1
end

# 086 runs as one transaction: the table and its indexes arrive together or not
# at all.
echo "→ 086_coverage_requests.sql"
psql "$url" -v ON_ERROR_STOP=1 --single-transaction -f $repo_root/migrations/086_coverage_requests.sql
or begin
    echo "✗ 086 failed. 087 was not attempted."
    exit 1
end

# 087 runs WITHOUT --single-transaction on purpose: a new enum value may not be
# used in the transaction that adds it, and some servers refuse ALTER TYPE …
# ADD VALUE inside an explicit transaction block altogether.
echo "→ 087_lead_acquisition_sources.sql"
psql "$url" -v ON_ERROR_STOP=1 -f $repo_root/migrations/087_lead_acquisition_sources.sql
or begin
    echo "✗ 087 failed. 086 is applied; re-run to retry 087."
    exit 1
end

echo "→ 088_homepage_features.sql"
psql "$url" -v ON_ERROR_STOP=1 --single-transaction -f $repo_root/migrations/088_homepage_features.sql
or begin
    echo "✗ 088 failed. 086 and 087 are applied; re-run to retry 088."
    exit 1
end

echo
echo "→ verifying"
psql "$url" -v ON_ERROR_STOP=1 -c "
  select
    (select count(*) from information_schema.tables
       where table_schema = 'public' and table_name = 'coverage_requests') as coverage_requests_table,
    (select count(*) from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = 'PlatformLeadAcquisitionSource'
        and e.enumlabel in ('DISCOVER_DEMAND','STUDENT_REFERRAL')) as new_lead_sources,
    (select count(*) from information_schema.tables
       where table_schema = 'public' and table_name = 'homepage_features') as homepage_features_table;
"

echo
echo "✓ Done. Expect coverage_requests_table = 1, new_lead_sources = 2, homepage_features_table = 1."
echo "  Deploy the app only after this reports those numbers — the code queries"
echo "  coverage_requests and writes the two new acquisition sources."
