#!/usr/bin/env fish
#
# Applies the two migrations the public homepage needs (ADR-223):
#
#   086_coverage_requests.sql        — the supply-request table
#   087_lead_acquisition_sources.sql — DISCOVER_DEMAND + STUDENT_REFERRAL
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
set -l migrations $repo_root/migrations/086_coverage_requests.sql $repo_root/migrations/087_lead_acquisition_sources.sql

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

if test -z "$url"
    if not test -f $repo_root/.env
        echo "✗ no .env at the repo root, and no connection string given."
        echo "  ./scripts/apply-homepage-migrations.fish --apply \"postgresql://…\""
        exit 1
    end
    # Read DATABASE_URL without sourcing .env (it holds secrets we do not want
    # exported into this shell, and values may contain characters fish would
    # try to interpret).
    set url (grep -m1 '^DATABASE_URL=' $repo_root/.env | string replace -r '^DATABASE_URL=' '' | string trim -c '"' | string trim -c "'")
end

if test -z "$url"
    echo "✗ DATABASE_URL is empty."
    exit 1
end

# Show where this is going without printing the password.
set -l target (string replace -r '^postgres(ql)?://[^@]*@' '' -- $url)
echo "Target : $target"
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

echo
echo "→ verifying"
psql "$url" -v ON_ERROR_STOP=1 -c "
  select
    (select count(*) from information_schema.tables
       where table_schema = 'public' and table_name = 'coverage_requests') as coverage_requests_table,
    (select count(*) from pg_enum e
       join pg_type t on t.oid = e.enumtypid
      where t.typname = 'PlatformLeadAcquisitionSource'
        and e.enumlabel in ('DISCOVER_DEMAND','STUDENT_REFERRAL')) as new_lead_sources;
"

echo
echo "✓ Done. Expect coverage_requests_table = 1 and new_lead_sources = 2."
echo "  Deploy the app only after this reports those numbers — the code queries"
echo "  coverage_requests and writes the two new acquisition sources."
