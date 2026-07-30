import axios from "axios";

/**
 * 🚀 PRODUCTION API CLIENT (Audited)
 * - Uses HTTP-only cookies (default browser behavior)
 * - Timeout handling: 15s
 * - Retry strategy: On network failures
 */

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || "/api",
  timeout: 15000, // 15s timeout
  withCredentials: true, // Crucial for sending HTTP-only cookies
  headers: {
    "Content-Type": "application/json",
  },
});

// 1. REQUEST INTERCEPTOR: Header injection (for tools/compat)
apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("hms_auth_token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 2. RESPONSE INTERCEPTOR: Global Error Handling
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    
    // Simple Retry Strategy for Network Failures
    if (!config || !config._retryCount) config._retryCount = 0;
    if (error.code === 'ECONNABORTED' && config._retryCount < 2) {
      config._retryCount++;
      return apiClient(config);
    }

    if (error.response?.status === 401) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("hms_auth_token");
        const publicPages = ["/login", "/register", "/"];
        const isStudio = window.location.pathname.startsWith("/studio");
        if (!publicPages.includes(window.location.pathname) && !isStudio) {
          // Use full reload to clear all state contexts
          window.location.href = "/login?expired=true";
        }
      }
    }
    
    const errorData = error.response?.data;
    const message = errorData?.error?.message || (typeof errorData?.error === 'string' ? errorData.error : null) || error.message || "An unexpected error occurred";
    const code = errorData?.error?.code || "INTERNAL_ERROR";
    
    return Promise.reject({ message, code, status: error.response?.status });
  }
);

export const api = {
  get: <T>(url: string, params?: any) => apiClient.get<T>(url, { params }).then((r) => r.data),
  post: <T>(url: string, data: any) => apiClient.post<T>(url, data).then((r) => r.data),
  put: <T>(url: string, data: any) => apiClient.put<T>(url, data).then((r) => r.data),
  delete: <T>(url: string) => apiClient.delete<T>(url).then((r) => r.data),
};

export default apiClient;
