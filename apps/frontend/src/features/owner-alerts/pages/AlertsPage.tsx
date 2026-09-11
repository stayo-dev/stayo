import { useNavigate } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts';
import { ALERT_CATEGORIES, ALERT_CATEGORY_LABEL, ALERT_CATEGORY_DESCRIPTION, ALERT_CATEGORY_PATH } from '../alertsCategories';
import { AlertCategoryRow } from '../components/AlertCategoryRow';
import { usePendingVerifications } from '@features/owner-tenants/hooks/usePendingVerifications';
import { PENDING_VERIFICATIONS_PATH } from '@features/owner-tenants/documents/kycDocuments';

/**
 * Alerts menu — Leads/Announcements/Renewals/Requests, per Stayo App.dc.html.
 * Reached via Home's bell icon, not the bottom nav (design has no Alerts nav
 * icon). Each category is its own dedicated page now (`/owner/alerts/leads`
 * etc.) — same list-card-then-navigate pattern as Tenants → tenant detail —
 * so this page is just the menu: four category cards. Search lives on each
 * dedicated page instead of here, scoped to that one category.
 */
export function AlertsPage() {
  const navigate = useNavigate();
  const alerts = useAlerts({ includeLeads: true });
  const documents = usePendingVerifications();

  const counts = {
    leads: alerts.leads.length,
    admin: alerts.adminMessages.length,
    renewals: alerts.renewals.length,
    requests: alerts.requests.length,
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Alerts</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Documents, leads, messages, renewals and tenant requests in one place</p>
      </div>

      <div className="flex flex-col gap-2">
        {/*
         * First, because it is the one category that is waiting on the owner
         * rather than informing them: a tenant's move-in paperwork sits unverified
         * until someone looks at it. Sourced from the same pending-documents
         * query as the Home dashboard's KYC card, so the two counts agree.
         */}
        <AlertCategoryRow
          label="Documents"
          description={
            documents.documentCount > 0
              ? `${documents.documentCount} upload${documents.documentCount === 1 ? '' : 's'} from ${documents.tenantCount} tenant${
                  documents.tenantCount === 1 ? '' : 's'
                } to review`
              : 'Aadhaar and ID uploads to approve'
          }
          count={documents.documentCount}
          actionable
          onClick={() => navigate(PENDING_VERIFICATIONS_PATH)}
        />
        {ALERT_CATEGORIES.map((c) => (
          <AlertCategoryRow
            key={c}
            label={ALERT_CATEGORY_LABEL[c]}
            description={ALERT_CATEGORY_DESCRIPTION[c]}
            count={counts[c]}
            onClick={() => navigate(ALERT_CATEGORY_PATH[c])}
          />
        ))}
      </div>
    </div>
  );
}
