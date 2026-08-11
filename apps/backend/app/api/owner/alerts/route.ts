import { NextRequest } from 'next/server';
import { getSession, apiResponse, apiError } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['OWNER', 'ADMIN'].includes(session.role)) {
    return apiError('Forbidden', 'FORBIDDEN', 403);
  }

  try {
    const ownerId = session.sub;

    // Fetch all active hostels for the owner to scope down the queries
    const ownerHostels = await prisma.hostels.findMany({
      where: { owner_id: ownerId, status: { in: ['ACTIVE', 'INACTIVE'] } },
      select: { id: true },
    });
    const hostelIds = ownerHostels.map((h: any) => h.id);

    // 1. Admin Broadcasts (Notifications for this owner)
    // We assume any notification sent to the owner's profile represents an admin message
    const notifications = await prisma.notifications.findMany({
      where: {
        profile_id: ownerId,
        is_read: false,
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });

    const formattedAdminMessages = notifications.map((n: any) => ({
      id: n.id,
      title: n.title || 'Platform Update',
      body: n.message,
      time: n.created_at,
      read: n.is_read,
    }));

    // 2. Renewals
    // Fetch active agreements ending in the next 30 days
    const next30Days = new Date();
    next30Days.setDate(next30Days.getDate() + 30);

    const renewals = await prisma.Agreement.findMany({
      where: {
        hostel_id: { in: hostelIds },
        status: { in: ['SIGNED', 'EXPIRING_SOON'] },
        agreement_end_date: {
          not: null,
          lte: next30Days,
        },
      },
      include: {
        tenant: {
          include: { profiles: true }
        }
      },
      orderBy: { agreement_end_date: 'asc' },
    });

    const formattedRenewals = renewals.map((r: any) => {
      const tenantName = r.tenant?.profiles?.name || 'Unknown Tenant';
      const daysLeft = r.agreement_end_date 
        ? Math.ceil((new Date(r.agreement_end_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        id: r.id,
        name: tenantName,
        detail: `Agreement expires on ${r.agreement_end_date ? new Date(r.agreement_end_date).toLocaleDateString() : 'Unknown'}`,
        days: daysLeft,
        read: false, // Agreements don't have read state in DB, dynamically generated
      };
    });

    // 3. Requests (Tenant Service Requests)
    const requests = await prisma.tenant_service_requests.findMany({
      where: {
        hostel_id: { in: hostelIds },
        status: { in: ['RAISED', 'IN_PROGRESS'] },
      },
      include: {
        tenants: {
          include: { profiles: true }
        }
      },
      orderBy: { created_at: 'desc' },
    });

    const formattedRequests = requests.map((r: any) => ({
      id: r.id,
      name: r.tenants?.profiles?.name || 'Unknown Tenant',
      detail: r.description || 'No description provided',
      type: r.type || 'General',
      read: false, // Service requests don't have an owner read state
    }));

    return apiResponse({
      adminMessages: formattedAdminMessages,
      renewals: formattedRenewals,
      requests: formattedRequests,
    });
  } catch (error: any) {
    console.error('[API owner/alerts] Error fetching alerts:', error);
    return apiError(error.message || 'Failed to fetch alerts');
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !['OWNER', 'ADMIN'].includes(session.role)) {
    return apiError('Forbidden', 'FORBIDDEN', 403);
  }

  try {
    const { category, id } = await req.json();

    if (category === 'admin') {
      await prisma.notifications.updateMany({
        where: { id: id, profile_id: session.sub },
        data: { is_read: true },
      });
    }
    // Renewals and requests are handled by state transitions elsewhere,
    // so we just return success without modifying them here.

    return apiResponse({ success: true });
  } catch (error: any) {
    return apiError(error.message || 'Failed to update alert');
  }
}
