#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# HMS - Setup Supabase Storage Bucket for Backups
# ═══════════════════════════════════════════════════════════════
# This script creates the 'db-backups' bucket in Supabase Storage
# Run once to initialize the backup storage.
#
# Usage: ./scripts/backup/setup-storage-bucket.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

# Load env vars
if [ -z "${SUPABASE_URL:-}" ]; then
    if [ -f ".env" ]; then
        export $(grep -E '^SUPABASE_URL=' .env | sed 's/"//g') 2>/dev/null || true
        export $(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' .env | sed 's/"//g') 2>/dev/null || true
    fi
    if [ -z "${SUPABASE_URL:-}" ] && [ -f "backend-next/.env" ]; then
        export $(grep -E '^SUPABASE_URL=' backend-next/.env | sed 's/"//g') 2>/dev/null || true
        export $(grep -E '^SUPABASE_SERVICE_ROLE_KEY=' backend-next/.env | sed 's/"//g') 2>/dev/null || true
    fi
fi

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    log_error "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set."
    exit 1
fi

echo "═══════════════════════════════════════════════════════"
echo "  Setting up Supabase Storage Buckets for Backups"
echo "═══════════════════════════════════════════════════════"
echo ""

# Create db-backups bucket (private - only service role can access)
log_info "Creating 'db-backups' bucket..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${SUPABASE_URL}/storage/v1/bucket" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "id": "db-backups",
        "name": "db-backups",
        "public": false,
        "file_size_limit": 524288000,
        "allowed_mime_types": ["application/gzip", "application/sql", "application/x-tar", "text/csv", "application/octet-stream"]
    }')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    log_success "Created 'db-backups' bucket"
elif echo "$BODY" | grep -q "already exists"; then
    log_info "'db-backups' bucket already exists"
else
    log_error "Failed to create 'db-backups' bucket: $BODY"
fi

# Create file-backups bucket for Supabase Storage file backups
log_info "Creating 'file-backups' bucket..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${SUPABASE_URL}/storage/v1/bucket" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d '{
        "id": "file-backups",
        "name": "file-backups",
        "public": false,
        "file_size_limit": 524288000
    }')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    log_success "Created 'file-backups' bucket"
elif echo "$BODY" | grep -q "already exists"; then
    log_info "'file-backups' bucket already exists"
else
    log_error "Failed to create 'file-backups' bucket: $BODY"
fi

echo ""
log_success "Storage buckets setup complete!"
echo ""
echo "Bucket structure:"
echo "  db-backups/"
echo "    ├── 2026-04-30/"
echo "    │   └── full_backup.sql.gz"
echo "    ├── 2026-04-29/"
echo "    │   └── full_backup.sql.gz"
echo "    └── ..."
echo ""
echo "  file-backups/"
echo "    ├── 2026-04-30/"
echo "    │   ├── documents.tar.gz"
echo "    │   └── receipts.tar.gz"
echo "    └── ..."
