#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# HMS - Upload Backup to Supabase Storage
# ═══════════════════════════════════════════════════════════════
# Uploads a local backup file to Supabase Storage db-backups bucket.
#
# Usage: 
#   ./scripts/backup/upload-to-storage.sh <file_path>
#   ./scripts/backup/upload-to-storage.sh backups/full/full_backup_2026-04-30.dump
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

FILE_PATH="${1:-}"
DATE=$(date +%F)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

if [ -z "$FILE_PATH" ]; then
    log_error "No file specified."
    echo "Usage: $0 <file_path>"
    echo "Example: $0 backups/full/full_backup_2026-04-30_14-30-00.dump"
    exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
    log_error "File not found: $FILE_PATH"
    exit 1
fi

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

# Determine content type
FILENAME=$(basename "$FILE_PATH")
case "$FILENAME" in
    *.sql.gz|*.gz)  CONTENT_TYPE="application/gzip" ;;
    *.sql)          CONTENT_TYPE="application/sql" ;;
    *.dump)         CONTENT_TYPE="application/octet-stream" ;;
    *.tar.gz)       CONTENT_TYPE="application/x-tar" ;;
    *.csv)          CONTENT_TYPE="text/csv" ;;
    *)              CONTENT_TYPE="application/octet-stream" ;;
esac

STORAGE_PATH="${DATE}/${FILENAME}"
FILE_SIZE=$(du -sh "$FILE_PATH" | cut -f1)

log_info "Uploading: ${FILENAME} (${FILE_SIZE})"
log_info "Destination: db-backups/${STORAGE_PATH}"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
    "${SUPABASE_URL}/storage/v1/object/db-backups/${STORAGE_PATH}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: ${CONTENT_TYPE}" \
    --data-binary @"${FILE_PATH}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    log_success "Upload successful!"
    log_info "Path: db-backups/${STORAGE_PATH}"
elif echo "$BODY" | grep -q "already exists"; then
    log_info "File already exists, updating..."
    # Use PUT to update
    RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT \
        "${SUPABASE_URL}/storage/v1/object/db-backups/${STORAGE_PATH}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Content-Type: ${CONTENT_TYPE}" \
        --data-binary @"${FILE_PATH}")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -1)
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        log_success "Update successful!"
    else
        log_error "Update failed: $(echo "$RESPONSE" | head -n -1)"
    fi
else
    log_error "Upload failed (HTTP ${HTTP_CODE}): ${BODY}"
    echo ""
    echo "Make sure the 'db-backups' bucket exists. Run:"
    echo "  ./scripts/backup/setup-storage-bucket.sh"
fi
