#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# HMS Local Database Backup Script
# ═══════════════════════════════════════════════════════════════
# Usage: ./scripts/backup/local-backup.sh [full|finance|all]
# 
# Requires: 
#   - PostgreSQL client (psql, pg_dump)
#   - DIRECT_URL environment variable set
#
# Example:
#   export DIRECT_URL="postgresql://user:pass@host:5432/db"
#   ./scripts/backup/local-backup.sh all
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
BACKUP_DIR="$(pwd)/backups"
DATE=$(date +%F)
TIMESTAMP=$(date +%F_%H-%M-%S)
BACKUP_TYPE="${1:-all}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Helper Functions ───────────────────────────────────────────
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

check_prerequisites() {
    if ! command -v pg_dump &> /dev/null; then
        log_error "pg_dump not found. Install PostgreSQL client:"
        echo "  sudo apt-get install postgresql-client"
        exit 1
    fi

    if ! command -v psql &> /dev/null; then
        log_error "psql not found. Install PostgreSQL client:"
        echo "  sudo apt-get install postgresql-client"
        exit 1
    fi

    # Check for DATABASE_URL (use DIRECT_URL for direct connection, not pooler)
    if [ -z "${DIRECT_URL:-}" ]; then
        # Try loading from .env
        if [ -f ".env" ]; then
            export $(grep -E '^DIRECT_URL=' .env | sed 's/"//g')
        fi
        if [ -f "backend-next/.env" ]; then
            export $(grep -E '^DIRECT_URL=' backend-next/.env | sed 's/"//g')
        fi
    fi

    if [ -z "${DIRECT_URL:-}" ]; then
        log_error "DIRECT_URL not set. Set it in .env or export it:"
        echo "  export DIRECT_URL=\"postgresql://user:pass@host:5432/db\""
        exit 1
    fi

    log_success "Prerequisites check passed"
}

# ── Full Database Backup ───────────────────────────────────────
full_backup() {
    log_info "Starting full database backup..."
    
    local full_dir="${BACKUP_DIR}/full"
    mkdir -p "$full_dir"

    # Custom format (best for pg_restore)
    log_info "Creating custom format dump..."
    pg_dump "$DIRECT_URL" \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        --format=custom \
        --file="${full_dir}/full_backup_${TIMESTAMP}.dump"
    
    log_success "Custom dump: ${full_dir}/full_backup_${TIMESTAMP}.dump"

    # SQL format (human readable, compressed)
    log_info "Creating SQL format dump..."
    pg_dump "$DIRECT_URL" \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        > "${full_dir}/full_backup_${TIMESTAMP}.sql"
    
    gzip "${full_dir}/full_backup_${TIMESTAMP}.sql"
    log_success "SQL dump: ${full_dir}/full_backup_${TIMESTAMP}.sql.gz"

    # Show size
    local size=$(du -sh "${full_dir}/full_backup_${TIMESTAMP}.dump" | cut -f1)
    log_info "Backup size: ${size}"
}

# ── Financial Tables Backup ────────────────────────────────────
finance_backup() {
    log_info "Starting financial tables backup..."
    
    local finance_dir="${BACKUP_DIR}/finance"
    mkdir -p "$finance_dir"

    # SQL dump of financial tables
    log_info "Dumping financial tables..."
    pg_dump "$DIRECT_URL" \
        --no-owner \
        --no-privileges \
        --clean \
        --if-exists \
        -t payments \
        -t payment_attempts \
        -t payment_webhook_events \
        -t rent_obligations \
        > "${finance_dir}/finance_backup_${TIMESTAMP}.sql"
    
    log_success "Finance SQL: ${finance_dir}/finance_backup_${TIMESTAMP}.sql"

    # CSV exports for ledger
    log_info "Exporting payments ledger CSV..."
    psql "$DIRECT_URL" -c "\COPY (
        SELECT 
            id, student_id, owner_id, amount, status,
            payment_method, reference_number, month, year,
            created_at, updated_at
        FROM payments 
        ORDER BY created_at DESC
    ) TO STDOUT WITH CSV HEADER" > "${finance_dir}/payments_ledger_${DATE}.csv" 2>/dev/null || \
    log_warn "Could not export payments CSV (table may not exist)"

    log_info "Exporting rent obligations CSV..."
    psql "$DIRECT_URL" -c "\COPY (
        SELECT * FROM rent_obligations ORDER BY created_at DESC
    ) TO STDOUT WITH CSV HEADER" > "${finance_dir}/rent_obligations_${DATE}.csv" 2>/dev/null || \
    log_warn "Could not export rent_obligations CSV (table may not exist)"

    log_info "Exporting payment attempts CSV..."
    psql "$DIRECT_URL" -c "\COPY (
        SELECT * FROM payment_attempts ORDER BY created_at DESC
    ) TO STDOUT WITH CSV HEADER" > "${finance_dir}/payment_attempts_${DATE}.csv" 2>/dev/null || \
    log_warn "Could not export payment_attempts CSV (table may not exist)"

    # Compress all finance backups
    log_info "Compressing finance backups..."
    tar -czf "${finance_dir}/finance_bundle_${TIMESTAMP}.tar.gz" \
        -C "$finance_dir" \
        "finance_backup_${TIMESTAMP}.sql" \
        "payments_ledger_${DATE}.csv" \
        "rent_obligations_${DATE}.csv" \
        "payment_attempts_${DATE}.csv" 2>/dev/null || true
    
    log_success "Finance bundle: ${finance_dir}/finance_bundle_${TIMESTAMP}.tar.gz"
}

# ── Schema-Only Backup ─────────────────────────────────────────
schema_backup() {
    log_info "Starting schema-only backup..."
    
    local schema_dir="${BACKUP_DIR}/schema"
    mkdir -p "$schema_dir"

    pg_dump "$DIRECT_URL" \
        --schema-only \
        --no-owner \
        --no-privileges \
        > "${schema_dir}/schema_${TIMESTAMP}.sql"
    
    log_success "Schema dump: ${schema_dir}/schema_${TIMESTAMP}.sql"
}

# ── Cleanup Old Backups ────────────────────────────────────────
cleanup_old_backups() {
    log_info "Cleaning up backups older than 30 days..."
    
    find "$BACKUP_DIR" -type f -mtime +30 -delete 2>/dev/null || true
    
    log_success "Old backups cleaned up"
}

# ── Main ───────────────────────────────────────────────────────
main() {
    echo "═══════════════════════════════════════════════════════"
    echo "  HMS Database Backup - ${DATE}"
    echo "═══════════════════════════════════════════════════════"
    echo ""

    check_prerequisites
    mkdir -p "$BACKUP_DIR"

    case "$BACKUP_TYPE" in
        full)
            full_backup
            ;;
        finance)
            finance_backup
            ;;
        schema)
            schema_backup
            ;;
        all)
            full_backup
            echo ""
            finance_backup
            echo ""
            schema_backup
            echo ""
            cleanup_old_backups
            ;;
        *)
            log_error "Unknown backup type: $BACKUP_TYPE"
            echo "Usage: $0 [full|finance|schema|all]"
            exit 1
            ;;
    esac

    echo ""
    echo "═══════════════════════════════════════════════════════"
    log_success "Backup completed successfully!"
    echo ""
    echo "Backup location: ${BACKUP_DIR}"
    du -sh "${BACKUP_DIR}" 2>/dev/null || true
    echo "═══════════════════════════════════════════════════════"
}

main
