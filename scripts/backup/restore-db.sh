# ── Restore Single Table ────────────────────────────────────────
restore_table() {
    if [ -z "$TABLE_NAME" ]; then
        log_error "No table specified."
        echo "Usage: $0 table <table_name> <backup_file>"
        exit 1
    fi

    if [ -z "$BACKUP_FILE" ]; then
        log_error "No backup file specified."
        echo "Usage: $0 table <table_name> <backup_file>"
        exit 1
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi

    # Default schema to public if not provided
    local target="$TABLE_NAME"
    if [[ "$TABLE_NAME" != *.* ]]; then
        target="public.$TABLE_NAME"
    fi

    confirm_action "Restore table ${target} from: $BACKUP_FILE"

    local ext="${BACKUP_FILE##*.}"

    case "$ext" in
        dump)
            log_info "Restoring table via pg_restore -t ${target}..."
            pg_restore "$BACKUP_FILE" \
                --dbname="$DIRECT_URL" \
                --no-owner \
                --no-privileges \
                --clean \
                --if-exists \
                --single-transaction \
                -t "$target" 2>&1 || true
            ;;
        gz)
            if [[ "$BACKUP_FILE" == *.sql.gz ]]; then
                log_info "Filtering SQL for table ${target} from compressed SQL..."
                # Best-effort restore: extract statements for the target table
                gunzip -c "$BACKUP_FILE" | awk -v t="${target}" '
                    BEGIN{IGNORECASE=1}
                    /COPY[ ]+[^;]*\(/ {inblock=1}
                    /;$/ {endstmt=1}
                    {
                      if ($0 ~ "TABLE \\"?" t "\\"?" || $0 ~ "COPY \\"?" t "\\"?" || inblock==1) {
                        print $0
                      }
                      if (endstmt==1) {inblock=0; endstmt=0}
                    }
                ' | psql "$DIRECT_URL" 2>&1 || true
            else
                log_error "Unknown gzip format for table restore"
                exit 1
            fi
            ;;
        sql)
            log_info "Filtering SQL for table ${target}..."
            awk -v t="${target}" '
                BEGIN{IGNORECASE=1}
                /COPY[ ]+[^;]*\(/ {inblock=1}
                /;$/ {endstmt=1}
                {
                  if ($0 ~ "TABLE \\"?" t "\\"?" || $0 ~ "COPY \\"?" t "\\"?" || inblock==1) {
                    print $0
                  }
                  if (endstmt==1) {inblock=0; endstmt=0}
                }
            ' "$BACKUP_FILE" | psql "$DIRECT_URL" 2>&1 || true
            ;;
        *)
            log_error "Unknown backup format: .$ext"
            echo "Supported: .dump, .sql, .sql.gz"
            exit 1
            ;;
    esac

    log_success "Table restore completed for ${target}!"
}
#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# HMS Database Restore Script
# ═══════════════════════════════════════════════════════════════
# Usage: 
#   ./scripts/backup/restore-db.sh full <backup_file>
#   ./scripts/backup/restore-db.sh finance <backup_file>
#   ./scripts/backup/restore-db.sh list
#
# Requires:
#   - PostgreSQL client (psql, pg_restore)
#   - DIRECT_URL environment variable set
#
# Examples:
#   ./scripts/backup/restore-db.sh list
#   ./scripts/backup/restore-db.sh full backups/full/full_backup_2026-04-30.dump
#   ./scripts/backup/restore-db.sh full backups/full/full_backup_2026-04-30.sql.gz
#   ./scripts/backup/restore-db.sh finance backups/finance/finance_backup_2026-04-30.sql
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
BACKUP_DIR="$(pwd)/backups"
RESTORE_TYPE="${1:-help}"
BACKUP_FILE="${2:-}"
TABLE_NAME=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helper Functions ───────────────────────────────────────────
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

check_prerequisites() {
    if ! command -v pg_restore &> /dev/null; then
        log_error "pg_restore not found. Install PostgreSQL client."
        exit 1
    fi
    if ! command -v psql &> /dev/null; then
        log_error "psql not found. Install PostgreSQL client."
        exit 1
    fi

    # Load DIRECT_URL from .env files if not set
    if [ -z "${DIRECT_URL:-}" ]; then
        if [ -f ".env" ]; then
            export $(grep -E '^DIRECT_URL=' .env | sed 's/"//g') 2>/dev/null || true
        fi
        if [ -z "${DIRECT_URL:-}" ] && [ -f "backend-next/.env" ]; then
            export $(grep -E '^DIRECT_URL=' backend-next/.env | sed 's/"//g') 2>/dev/null || true
        fi
    fi

    if [ -z "${DIRECT_URL:-}" ]; then
        log_error "DIRECT_URL not set. Set it in .env or export it."
        exit 1
    fi
}

confirm_action() {
    local message="$1"
    echo ""
    echo -e "${RED}${BOLD}⚠️  WARNING: $message${NC}"
    echo ""
    echo -e "${YELLOW}This will OVERWRITE data in the target database!${NC}"
    echo -e "${YELLOW}Make sure you have a current backup before proceeding.${NC}"
    echo ""
    read -p "Type 'YES' to confirm: " confirmation
    if [ "$confirmation" != "YES" ]; then
        log_info "Restore cancelled."
        exit 0
    fi
}

# ── List Available Backups ─────────────────────────────────────
list_backups() {
    echo "═══════════════════════════════════════════════════════"
    echo "  Available Backups"
    echo "═══════════════════════════════════════════════════════"
    echo ""

    if [ ! -d "$BACKUP_DIR" ]; then
        log_warn "No backups directory found at: $BACKUP_DIR"
        echo "  Run: ./scripts/backup/local-backup.sh all"
        exit 0
    fi

    echo -e "${BOLD}Full Backups:${NC}"
    if [ -d "${BACKUP_DIR}/full" ]; then
        ls -lh "${BACKUP_DIR}/full/"*.dump 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
        ls -lh "${BACKUP_DIR}/full/"*.sql.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    else
        echo "  (none)"
    fi
    echo ""

    echo -e "${BOLD}Finance Backups:${NC}"
    if [ -d "${BACKUP_DIR}/finance" ]; then
        ls -lh "${BACKUP_DIR}/finance/"*.sql 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
        ls -lh "${BACKUP_DIR}/finance/"*.tar.gz 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    else
        echo "  (none)"
    fi
    echo ""

    echo -e "${BOLD}Schema Backups:${NC}"
    if [ -d "${BACKUP_DIR}/schema" ]; then
        ls -lh "${BACKUP_DIR}/schema/"*.sql 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    else
        echo "  (none)"
    fi
    echo ""

    echo -e "${BOLD}CSV Exports:${NC}"
    if [ -d "${BACKUP_DIR}/finance" ]; then
        ls -lh "${BACKUP_DIR}/finance/"*.csv 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
    else
        echo "  (none)"
    fi
}

# ── Full Database Restore ──────────────────────────────────────
restore_full() {
    if [ -z "$BACKUP_FILE" ]; then
        log_error "No backup file specified."
        echo "Usage: $0 full <backup_file>"
        echo ""
        echo "Available full backups:"
        ls -lh "${BACKUP_DIR}/full/" 2>/dev/null || echo "  (none found)"
        exit 1
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi

    confirm_action "Full database restore from: $BACKUP_FILE"

    local ext="${BACKUP_FILE##*.}"

    case "$ext" in
        dump)
            log_info "Restoring from custom format dump..."
            pg_restore "$BACKUP_FILE" \
                --dbname="$DIRECT_URL" \
                --no-owner \
                --no-privileges \
                --clean \
                --if-exists \
                --single-transaction \
                2>&1 || true
            ;;
        gz)
            log_info "Decompressing and restoring from SQL dump..."
            gunzip -c "$BACKUP_FILE" | psql "$DIRECT_URL" 2>&1 || true
            ;;
        sql)
            log_info "Restoring from SQL dump..."
            psql "$DIRECT_URL" < "$BACKUP_FILE" 2>&1 || true
            ;;
        *)
            log_error "Unknown backup format: .$ext"
            echo "Supported: .dump, .sql, .sql.gz"
            exit 1
            ;;
    esac

    log_success "Full database restore completed!"
    echo ""
    log_warn "Run 'npx prisma migrate deploy' if you use Prisma migrations."
}

# ── Finance Tables Restore ─────────────────────────────────────
restore_finance() {
    if [ -z "$BACKUP_FILE" ]; then
        log_error "No backup file specified."
        echo "Usage: $0 finance <backup_file>"
        exit 1
    fi

    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi

    confirm_action "Financial tables restore from: $BACKUP_FILE"

    local ext="${BACKUP_FILE##*.}"

    case "$ext" in
        sql)
            log_info "Restoring financial tables from SQL..."
            psql "$DIRECT_URL" < "$BACKUP_FILE" 2>&1 || true
            ;;
        gz)
            if [[ "$BACKUP_FILE" == *.tar.gz ]]; then
                log_info "Extracting finance bundle..."
                local tmp_dir=$(mktemp -d)
                tar -xzf "$BACKUP_FILE" -C "$tmp_dir"
                
                # Find and restore the .sql file
                local sql_file=$(find "$tmp_dir" -name "finance_backup_*.sql" | head -1)
                if [ -n "$sql_file" ]; then
                    log_info "Restoring from: $sql_file"
                    psql "$DIRECT_URL" < "$sql_file" 2>&1 || true
                else
                    log_error "No SQL file found in archive"
                fi
                rm -rf "$tmp_dir"
            else
                log_info "Decompressing and restoring..."
                gunzip -c "$BACKUP_FILE" | psql "$DIRECT_URL" 2>&1 || true
            fi
            ;;
        *)
            log_error "Unknown format: .$ext"
            exit 1
            ;;
    esac

    log_success "Financial tables restore completed!"
}

# ── Verify Database After Restore ──────────────────────────────
verify_restore() {
    check_prerequisites
    
    echo "═══════════════════════════════════════════════════════"
    echo "  Database Verification"
    echo "═══════════════════════════════════════════════════════"
    echo ""

    log_info "Checking table counts..."
    
    psql "$DIRECT_URL" -c "
        SELECT 
            schemaname || '.' || relname AS table_name,
            n_live_tup AS row_count
        FROM pg_stat_user_tables 
        ORDER BY n_live_tup DESC
        LIMIT 20;
    " 2>/dev/null || log_warn "Could not query table stats"

    echo ""
    log_info "Checking critical tables..."
    
    for table in payments payment_attempts rent_obligations profiles rooms students hostels; do
        count=$(psql "$DIRECT_URL" -t -c "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "N/A")
        echo "  $table: $(echo $count | xargs) rows"
    done

    echo ""
    log_success "Verification complete"
}

# ── Download from GitHub Artifacts ─────────────────────────────
download_github_backup() {
    log_info "To download backups from GitHub Actions:"
    echo ""
    echo "  1. Go to: https://github.com/Shivaprakash001/hms/actions"
    echo "  2. Click on the latest 'Daily DB Backup' run"
    echo "  3. Download the artifact (db-full-backup-* or db-finance-backup-*)"
    echo "  4. Extract and restore:"
    echo ""
    echo "     unzip db-full-backup-*.zip"
    echo "     ./scripts/backup/restore-db.sh full full_backup_2026-04-30.dump"
    echo ""
    echo "  Or use GitHub CLI:"
    echo "     gh run download <run-id> -n db-full-backup-<run-id>"
}

# ── Help ───────────────────────────────────────────────────────
show_help() {
    echo "═══════════════════════════════════════════════════════"
    echo "  HMS Database Restore Tool"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    echo "Usage: $0 <command> [options]"
    echo ""
    echo "Commands:"
    echo "  list                     List available local backups"
    echo "  full <backup_file>       Restore full database"
    echo "  finance <backup_file>    Restore financial tables only"
    echo "  verify                   Verify database after restore"
    echo "  github                   Show how to download GitHub backups"
    echo "  help                     Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 list"
    echo "  $0 full backups/full/full_backup_2026-04-30_14-30-00.dump"
    echo "  $0 full backups/full/full_backup_2026-04-30_14-30-00.sql.gz"
    echo "  $0 finance backups/finance/finance_backup_2026-04-30_14-30-00.sql"
    echo "  $0 verify"
    echo ""
}

# ── Main ───────────────────────────────────────────────────────
main() {
    case "$RESTORE_TYPE" in
        list)
            list_backups
            ;;
        full)
            check_prerequisites
            restore_full
            ;;
        finance)
            check_prerequisites
            restore_finance
            ;;
        table)
            check_prerequisites
            TABLE_NAME="${2:-}"
            BACKUP_FILE="${3:-}"
            restore_table
            ;;
        verify)
            verify_restore
            ;;
        github)
            download_github_backup
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            log_error "Unknown command: $RESTORE_TYPE"
            show_help
            exit 1
            ;;
    esac
}

main
