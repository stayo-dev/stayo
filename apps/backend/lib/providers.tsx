"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { api } from "./api-client";
import { useRouter, usePathname } from "next/navigation";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  owner_id?: string;
  tenant_id?: string;
  is_profile_completed: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const initAuth = async () => {
      try {
        // Now just call /auth/me; the browser handles the HTTP-only cookie
        const data = await api.get<User>("/auth/me");
        setUser(data);
      } catch (error) {
        // This is safe to ignore on first load for guests
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  useEffect(() => {
    console.log("AuthGuard trace:", { pathname, loading, user: !!user });
    if (loading) return;
    if (pathname && pathname.startsWith("/studio")) {
      console.log("AuthGuard: bypassing redirect for studio path", pathname);
      return;
    }

    const publicPages = ["/login", "/register", "/"];
    const isPublic = publicPages.includes(pathname);

    if (!user && !isPublic) {
      console.log("AuthGuard: redirecting to /login from", pathname);
      router.push("/login");
    } else if (user && isPublic) {
      console.log("AuthGuard: redirecting to dashboard for logged in user");
      router.push(user.role === "TENANT" ? "/tenant/dashboard" : "/owner/dashboard");
    }
  }, [user, loading, pathname, router]);

  const login = async (email: string, password: string) => {
    const data = await api.post<{ user: User }>("/api/auth/login", { email, password });
    setUser(data.user);
    // Token is now set in HTTP-only cookie by the server
  };

  const logout = async () => {
    await api.post("/auth/logout", {});
    setUser(null);
    router.push("/login");
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user, loading, login, logout }}>
        {!loading && children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth error");
  return context;
};
