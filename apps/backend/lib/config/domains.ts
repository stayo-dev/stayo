export const PRODUCTION_FRONTEND_URL = "https://yourstayo.com";
export const PRODUCTION_FRONTEND_WWW_URL = "https://www.yourstayo.com";
export const PRODUCTION_BACKEND_URL = "https://api.yourstayo.com";

// Temporary Vercel preview URLs used while testing this deployment before
// yourstayo.com's custom domain/DNS is live. Remove once VITE_API_URL /
// the frontend both move to the real custom domains.
const TEMPORARY_LEGACY_FRONTEND_ORIGINS: string[] = [
  "https://stayo-drc3.vercel.app",
];

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

function isProductionRuntime() {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function joinUrl(base: string, path = "") {
  const cleanBase = normalizeUrl(base);
  if (!path) return cleanBase;
  return `${cleanBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export function getFrontendUrl() {
  const resolved = normalizeUrl(process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL) || PRODUCTION_FRONTEND_URL;
  if (resolved.includes("api.sriadithyahostels.in")) {
    return PRODUCTION_FRONTEND_URL;
  }
  if (isProductionRuntime() && isLocalhostUrl(resolved)) {
    return PRODUCTION_FRONTEND_URL;
  }
  return resolved;
}


export function getBackendUrl() {
  return normalizeUrl(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.API_URL ||
      process.env.BACKEND_URL
  ) || PRODUCTION_BACKEND_URL;
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
  return Array.from(new Set([
    PRODUCTION_FRONTEND_URL,
    PRODUCTION_FRONTEND_WWW_URL,
    getFrontendUrl(),
    ...envList(process.env.CORS_ALLOWED_ORIGINS),
    ...envList(process.env.LEGACY_FRONTEND_ORIGINS),
    ...TEMPORARY_LEGACY_FRONTEND_ORIGINS,
  ].map((origin) => normalizeUrl(origin)).filter(Boolean)));
}

export function getCorsAllowOrigin(requestOrigin?: string | null) {
  const origin = normalizeUrl(requestOrigin);
  if (!origin) return PRODUCTION_FRONTEND_URL;
  // Any localhost/127.0.0.1 origin is allowed in dev, regardless of port —
  // Vite auto-increments past its default port whenever it's already taken
  // (e.g. a second dev server left running from an earlier session), so
  // pinning CORS_ALLOWED_ORIGINS to one specific port breaks the moment that
  // happens. Production stays exact-match only.
  if (!isProductionRuntime() && isLocalhostUrl(origin)) return origin;
  return getAllowedFrontendOrigins().includes(origin) ? origin : PRODUCTION_FRONTEND_URL;
}
