export const admissionsPublicService = {
  getVisitHostel: async (slug: string) => {
    const res = await fetch(`/api/visit/${slug}`);
    if (!res.ok) {
      throw new Error(`Failed to fetch hostel: ${res.statusText}`);
    }
    const data = await res.json();
    return data?.data ?? data;
  },
  createLead: async (slug: string, payload: any) => {
    const res = await fetch(`/api/visit/${slug}/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to create lead: ${res.statusText}`);
    }
    const data = await res.json();
    return data?.data ?? data;
  },
  recordActivity: async (slug: string, payload: any) => {
    const res = await fetch(`/api/visit/${slug}/activities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Failed to record activity: ${res.statusText}`);
    }
    const data = await res.json();
    return data?.data ?? data;
  },
};
