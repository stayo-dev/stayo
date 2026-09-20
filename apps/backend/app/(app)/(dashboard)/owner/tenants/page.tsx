"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/providers";

/**
 * Tenant list integration example.
 * Demonstrates: React Query + API Client + Auth Context.
 */
export default function TenantsPage() {
  const { user } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["tenants", user?.id],
    queryFn: () => api.get<{ tenants: any[] }>("/tenants"),
    enabled: !!user,
  });

  if (isLoading) return <div className="p-8">Loading tenants...</div>;
  if (error) return <div className="p-8 text-red-500">Error: {(error as any).message}</div>;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Tenant Directory</h1>
      <div className="grid gap-4">
        {data?.tenants.map((tenant) => (
          <div key={tenant.id} className="p-4 bg-white shadow rounded-lg border">
            <p className="font-semibold">{tenant.profile.name}</p>
            <p className="text-sm text-gray-500">{tenant.profile.email}</p>
            <div className="mt-2">
              <span className={`px-2 py-1 text-xs rounded ${tenant.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                {tenant.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
