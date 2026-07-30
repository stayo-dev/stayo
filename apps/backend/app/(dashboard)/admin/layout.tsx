"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/providers";

/**
 * Admin dashboard shell.
 *
 * - Strict ADMIN guard. Non-admins are redirected to /login.
 * - Renders a fixed sidebar of treasury surfaces. The sidebar is
 *   intentionally austere — these pages are operational and read-heavy;
 *   visual real-estate goes to data, not chrome.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role !== "ADMIN") router.replace("/login?error=admin_required");
  }, [user, loading, router]);

  if (loading || !user || user.role !== "ADMIN") {
    return <div className="p-8 text-sm text-gray-500">Authenticating…</div>;
  }

  const nav = [
    { href: "/admin", label: "Treasury Overview" },
    { href: "/admin/settlements", label: "Settlement Queue" },
    { href: "/admin/reconciliation", label: "Reconciliation" },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="flex">
        <aside className="w-64 min-h-screen border-r border-gray-200 bg-white">
          <div className="p-4 border-b border-gray-200">
            <div className="text-xs uppercase tracking-wider text-gray-500">Sri Adithya Boys Hostel Treasury</div>
            <div className="text-sm font-semibold mt-1">{user.name}</div>
            <div className="text-xs text-gray-500">{user.email}</div>
          </div>
          <nav className="p-2">
            {nav.map((n) => {
              const active = pathname === n.href || (n.href !== "/admin" && pathname.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`block px-3 py-2 rounded text-sm ${
                    active ? "bg-gray-900 text-white" : "text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
