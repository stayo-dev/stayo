#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# HMS - Backup Supabase Storage Files
# ═══════════════════════════════════════════════════════════════
# Backs up files stored in Supabase Storage buckets:
#   - tenant documents (ID proofs, agreements)
#   - receipts / payment screenshots
#   - hostel logos
#
# Usage: ./scripts/backup/backup-storage-files.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

DATE=$(date +%F)
TIMESTAMP=$(date +%F_%H-%M-%S)
BACKUP_DIR="$(pwd)/backups/storage/${DATE}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
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
echo "  HMS Storage Files Backup - ${DATE}"
echo "═══════════════════════════════════════════════════════"
echo ""

mkdir -p "$BACKUP_DIR"

# ── List all buckets ───────────────────────────────────────────
log_info "Fetching storage buckets..."
BUCKETS=$(curl -s \
    "${SUPABASE_URL}/storage/v1/bucket" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}")

echo "$BUCKETS" | jq -r '.[].name' 2>/dev/null || {
    log_error "Failed to list buckets"
    exit 1
}

# ── Backup each bucket ────────────────────────────────────────
backup_bucket() {
    local bucket_name="$1"
    local bucket_dir="${BACKUP_DIR}/${bucket_name}"
    mkdir -p "$bucket_dir"

    log_info "Backing up bucket: ${bucket_name}..."

    # List all files in bucket
    local files=$(curl -s \
        "${SUPABASE_URL}/storage/v1/object/list/${bucket_name}" \
        -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
        -H "Content-Type: application/json" \
        -d '{"prefix":"","limit":10000,"sortBy":{"column":"name","order":"asc"}}')

    # Count files
    local count=$(echo "$files" | jq 'length' 2>/dev/null || echo "0")
    log_info "  Found ${count} items in ${bucket_name}"

    if [ "$count" = "0" ] || [ "$count" = "null" ]; then
        log_warn "  No files in bucket ${bucket_name}, skipping"
        return
    fi

    # Download each file
    echo "$files" | jq -r '.[] | select(.id != null) | .name' 2>/dev/null | while read -r file_name; do
        if [ -n "$file_name" ]; then
            local output_file="${bucket_dir}/${file_name}"
            mkdir -p "$(dirname "$output_file")"
            
            curl -s -o "$output_file" \
                "${SUPABASE_URL}/storage/v1/object/${bucket_name}/${file_name}" \
                -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
                2>/dev/null || log_warn "  Failed to download: ${file_name}"
        fi
    done

    # Compress bucket backup
    if [ "$(ls -A "$bucket_dir" 2>/dev/null)" ]; then
        tar -czf "${BACKUP_DIR}/${bucket_name}_${TIMESTAMP}.tar.gz" \
            -C "$BACKUP_DIR" "${bucket_name}"
        log_success "  Compressed: ${bucket_name}_${TIMESTAMP}.tar.gz"
    else
        log_warn "  No files downloaded from ${bucket_name}"
    fi
}

# ── Backup known buckets ──────────────────────────────────────
# Skip backup buckets themselves
SKIP_BUCKETS="db-backups file-backups"

for bucket in $(echo "$BUCKETS" | jq -r '.[].name' 2>/dev/null); do
    if echo "$SKIP_BUCKETS" | grep -qw "$bucket"; then
        log_info "Skipping backup bucket: ${bucket}"
        continue
    fi
    backup_bucket "$bucket"
    echo ""
done

# ── Summary ────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
log_success "Storage backup completed!"
echo ""
echo "Backup location: ${BACKUP_DIR}"
du -sh "${BACKUP_DIR}" 2>/dev/null || true
echo ""
echo "Files:"
ls -lh "${BACKUP_DIR}"/*.tar.gz 2>/dev/null || echo "  (no compressed archives)"
echo "═══════════════════════════════════════════════════════"
