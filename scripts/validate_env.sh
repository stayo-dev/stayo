#!/bin/bash

# Define colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo "🔍 Validating Environment Variables..."

MISSING_VARS=0

# Define required arrays. Kept in sync with .env.example / apps/frontend/.env.example
# — update those first, then mirror the required subset here.
BACKEND_VARS=(
  "DATABASE_URL"
  "DIRECT_URL"
  "SUPABASE_URL"
  "SUPABASE_ANON_KEY"
  "SUPABASE_SERVICE_ROLE_KEY"
  "JWT_SECRET"
  "RECEIPT_VERIFY_SECRET"
  "CRON_SECRET"
  "RESEND_API_KEY"
  "EMAIL_FROM"
  "RAZORPAY_KEY_ID"
  "RAZORPAY_KEY_SECRET"
  "RAZORPAY_WEBHOOK_SECRET"
  "WHATSAPP_ACCESS_TOKEN"
  "WHATSAPP_PHONE_NUMBER_ID"
  "WHATSAPP_BUSINESS_ACCOUNT_ID"
  "WHATSAPP_WEBHOOK_VERIFY_TOKEN"
  "META_APP_SECRET"
)
FRONTEND_VARS=(
  "VITE_API_URL"
  "VITE_SUPABASE_URL"
  "VITE_SUPABASE_ANON_KEY"
)

# Function to check vars
check_vars() {
  local file=$1
  shift
  local vars=("$@")

  if [ ! -f "$file" ]; then
    echo -e "${RED}❌ Missing $file file!${NC}"
    MISSING_VARS=1
    return
  fi

  for var in "${vars[@]}"; do
    if ! grep -q "^${var}=" "$file" || [ -z "$(grep "^${var}=" "$file" | cut -d '=' -f2- | tr -d ' ')" ]; then
      echo -e "${RED}❌ Missing or empty $var in $file${NC}"
      MISSING_VARS=1
    else
      echo -e "${GREEN}✅ Found $var in $file${NC}"
    fi
  done
}

# apps/backend reads env from the REPO ROOT .env (DOTENV_CONFIG_PATH=../../.env
# in its npm scripts) — not from an .env file inside apps/backend itself.
echo -e "\n🛠 Checking Backend Environment (repo root .env)..."
BACKEND_ENV=".env"
check_vars "$BACKEND_ENV" "${BACKEND_VARS[@]}"

echo -e "\n💻 Checking Frontend Environment (apps/frontend/.env)..."
FRONTEND_ENV="apps/frontend/.env"
check_vars "$FRONTEND_ENV" "${FRONTEND_VARS[@]}"

echo -e "\n✨ Validation Summary:"
if [ $MISSING_VARS -eq 0 ]; then
  echo -e "${GREEN}All required environment variables are present! 🎉${NC}"
  exit 0
else
  echo -e "${RED}Some required environment variables are missing. Please review the output above and refer to .env.example / apps/frontend/.env.example.${NC}"
  exit 1
fi
