export const PRODUCTION_FRONTEND_URL = "https://yourstayo.com";
export const PRODUCTION_FRONTEND_WWW_URL = "https://www.yourstayo.com";
export const PRODUCTION_BACKEND_URL = "https://api.yourstayo.com";

function normalizeUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.origin;
  } catch {
    return withProtocol.replace(/\/+$/, "");
  }
}

function normalizeFullUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "postmessage") return raw;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.pathname === "/" && !parsed.search && !parsed.hash) return parsed.origin;
    return parsed.toString();
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function envList(value?: string | null) {
  return String(value || "")
    .split(",")
    .map((item) => normalizeUrl(item))
    .filter(Boolean);
}

function isLocalhostUrl(value?: string | null) {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;

  try {
    const hostname = new URL(normalized).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return normalized.includes("localhost") || normalized.includes("127.0.0.1");
  }
}

// Next.js sets NODE_ENV=production for every `next build`/`next start` —
// including a Vercel Preview deployment, which is how Staging deploys in
// this project's workflow. NODE_ENV therefore CANNOT distinguish Staging
// from Production; only VERCEL_ENV can (Vercel sets it to "production" for
// the Production deployment and "preview" for every Preview/Staging one).
function isVercelDeployment() {
  return Boolean(process.env.VERCEL_ENV);
}

function isProductionEnvironment() {
  return process.env.VERCEL_ENV === "production";
}

// Any Vercel deployment that is NOT the real Production one — i.e. a
// Preview deployment, which is how Staging deploys per this project's
// workflow (PR -> Preview Deployment -> merge -> Production Deployment).
function isNonProductionVercelDeployment() {
  return isVercelDeployment() && !isProductionEnvironment();
}

function joinUrl(base: string, path = "") {
  const cleanBase = normalizeUrl(base);
  if (!path) return cleanBase;
  return `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getFrontendUrl() {
  const resolved = normalizeUrl(process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL);
  if (resolved) return resolved;

  if (isNonProductionVercelDeployment()) {
    // Staging must never silently fall back to the production frontend URL —
    // that is exactly the cross-environment leak this check exists to close.
    throw new Error(
      "FRONTEND_URL (or NEXT_PUBLIC_FRONTEND_URL) is not set for this non-production Vercel " +
        "deployment. Refusing to fall back to the production frontend URL — set it explicitly " +
        "in this Vercel project's Environment Variables."
    );
  }

  // Real production, or a local/non-Vercel runtime (e.g. a one-off script):
  // keep the existing fallback as a safety net. TODO: once Production's own
  // Vercel env vars are confirmed to set this explicitly, this branch can be
  // tightened to throw for isProductionEnvironment() too.
  return PRODUCTION_FRONTEND_URL;
}

export function getBackendUrl() {
  const resolved = normalizeUrl(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.API_URL ||
      process.env.BACKEND_URL
  );
  if (resolved) return resolved;

  if (isNonProductionVercelDeployment()) {
    throw new Error(
      "BACKEND_URL (or NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_API_URL / API_URL) is not set for this " +
        "non-production Vercel deployment. Refusing to fall back to the production backend URL " +
        "— set it explicitly in this Vercel project's Environment Variables."
    );
  }

  return PRODUCTION_BACKEND_URL;
}

export function frontendUrl(path = "") {
  return joinUrl(getFrontendUrl(), path);
}

export function backendUrl(path = "") {
  return joinUrl(getBackendUrl(), path);
}

export function getGoogleRedirectUri() {
  return normalizeFullUrl(process.env.GOOGLE_REDIRECT_URI) || frontendUrl("/callback");
}

export function getAllowedFrontendOrigins() {
  return Array.from(
    new Set(
      [
        // The hardcoded production origin is only trusted when this really
        // is the production deployment (or a local/non-Vercel runtime) —
        // never for Staging, which must build its allowlist purely from its
        // own explicit env vars.
        ...(isProductionEnvironment() || !isVercelDeployment()
          ? [PRODUCTION_FRONTEND_URL, PRODUCTION_FRONTEND_WWW_URL]
          : []),
        getFrontendUrl(),
        ...envList(process.env.CORS_ALLOWED_ORIGINS),
        ...envList(process.env.LEGACY_FRONTEND_ORIGINS),
      ]
        .map((origin) => normalizeUrl(origin))
        .filter(Boolean)
    )
  );
}

export function getCorsAllowOrigin(requestOrigin?: string | null) {
  const origin = normalizeUrl(requestOrigin);
  if (!origin) return "";
  // Any localhost/127.0.0.1 origin is allowed on a genuinely local, non-Vercel
  // runtime, regardless of port — Vite auto-increments past its default port
  // whenever it's already taken. Never applies on any Vercel deployment,
  // Staging or Production.
  if (!isVercelDeployment() && isLocalhostUrl(origin)) return origin;
  if (getAllowedFrontendOrigins().includes(origin)) return origin;
  // An unrecognized origin gets no CORS header at all in every environment
  // except real production, which echoes back its own canonical origin —
  // unchanged from prior behavior, and harmless (the browser only accepts a
  // response whose Allow-Origin matches the request's actual origin).
  return isProductionEnvironment() ? PRODUCTION_FRONTEND_URL : "";
}
