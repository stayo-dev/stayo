import crypto from "crypto";

export const CSRF_COOKIE_NAME = "hms_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sharedCookieDomain() {
  const explicit = String(process.env.COOKIE_DOMAIN || "").trim();
  if (explicit) return explicit;

  const frontend = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL;
  const backend =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    process.env.BACKEND_URL;
  if (!frontend || !backend) return undefined;

  try {
    const frontendHost = new URL(frontend).hostname;
    const backendHost = new URL(backend).hostname;
    if (
      frontendHost === "localhost" ||
      backendHost === "localhost" ||
      frontendHost.endsWith(".vercel.app") ||
      backendHost.endsWith(".vercel.app")
    ) {
      return undefined;
    }
    const frontendParts = frontendHost.split(".");
    const backendParts = backendHost.split(".");
    const frontendRoot = frontendParts.slice(-2).join(".");
    const backendRoot = backendParts.slice(-2).join(".");
    if (frontendRoot && frontendRoot === backendRoot) return `.${frontendRoot}`;
  } catch {
    return undefined;
  }

  return undefined;
}

export function getCsrfCookieOptions(maxAge: number) {
  const isProd = process.env.NODE_ENV === "production";
  const domain = sharedCookieDomain();
  return {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax" as const,
    maxAge,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function setCsrfCookie(
  response: { cookies: { set: Function }; headers?: { set: Function } },
  maxAge: number,
) {
  const token = generateCsrfToken();
  response.cookies.set(CSRF_COOKIE_NAME, token, getCsrfCookieOptions(maxAge));
  response.headers?.set(CSRF_HEADER_NAME, token);
}

export function clearCsrfCookie(response: { cookies: { set: Function } }) {
  const options = getCsrfCookieOptions(0);
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    ...options,
    expires: new Date(0),
  });
}

export function isUnsafeMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function isValidCsrfPair(cookieToken?: string | null, headerToken?: string | null) {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length < 32 || headerToken.length < 32) return false;
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (cookieBuffer.length !== headerBuffer.length) return false;
  return crypto.timingSafeEqual(cookieBuffer, headerBuffer);
}
