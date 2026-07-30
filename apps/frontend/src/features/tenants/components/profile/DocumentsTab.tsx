// frontend-v2/src/features/tenants/components/profile/DocumentsTab.tsx
import { useState } from 'react';
import { FileCheck2, FileStack } from 'lucide-react';
import { VerificationPanel } from '@features/tenants/components/documents/VerificationPanel';
import { DocumentsHub } from '@features/tenants/components/financial/DocumentsHub';

type DocGroup = 'kyc' | 'contract';

interface RecentPayment {
  id: string;
  amount?: number;
  date?: string;
  method?: string;
  reference_number?: string;
}

interface ChangeRequestSummary {
  id: string;
  change_type?: string;
  status?: string;
  requested_at?: string;
  applied_at?: string;
}

interface DocumentsTabProps {
  hostelId: string;
  tenantId: string;
  profileType?: string;
  photoUrl?: string;
  documents: Record<string, any>[];
  documentVerificationStatus: string;
  onDocumentsUpdated: () => void;
  onRemindDocuments: () => void;
  onResendRules: () => void;
  onDownloadAcceptanceRecord: () => void;
  hasAgreement: boolean;
  recentPayments: RecentPayment[];
  recentChanges: ChangeRequestSummary[];
  onViewAllChanges?: () => void;
}

const STATUS_BADGE: Record<string, string> = {
  VERIFIED: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  PENDING: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

/**
 * Merges the former standalone "KYC Verification & Documents" card with the
 * financial DocumentsHub (Agreement/Receipts/Payment Link/Change Request) —
 * both are "documents for this tenant," just different document families.
 */
export function DocumentsTab({
  hostelId,
  tenantId,
  profileType,
  photoUrl,
  documents,
  documentVerificationStatus,
  onDocumentsUpdated,
  onRemindDocuments,
  onResendRules,
  onDownloadAcceptanceRecord,
  hasAgreement,
  recentPayments,
  recentChanges,
  onViewAllChanges,
}: DocumentsTabProps) {
  const [group, setGroup] = useState<DocGroup>('kyc');

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setGroup('kyc')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
            group === 'kyc' ? 'bg-accent text-accent-foreground border-accent' : 'bg-card text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>Identity &amp; KYC</span>
          <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full border font-bold uppercase ${STATUS_BADGE[documentVerificationStatus] ?? 'bg-rose-500/10 text-rose-600 border-rose-500/20'}`}>
            {documentVerificationStatus}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setGroup('contract')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
            group === 'contract' ? 'bg-accent text-accent-foreground border-accent' : 'bg-card text-muted-foreground border-border hover:text-foreground'
          }`}
        >
          <FileStack className="w-3.5 h-3.5" />
          <span>Contract &amp; Payments</span>
        </button>
      </div>

      {group === 'kyc' ? (
        <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
          <div className="flex gap-3 flex-wrap justify-between items-center text-xs">
            <div className="flex gap-2">
              <button type="button" onClick={onRemindDocuments} className="text-accent font-semibold hover:underline">
                Remind documents
              </button>
              <span className="text-muted-foreground/30">·</span>
              <button type="button" onClick={onResendRules} className="text-muted-foreground hover:text-foreground hover:underline">
                Resend rules reminder
              </button>
            </div>
            <button type="button" onClick={onDownloadAcceptanceRecord} className="text-muted-foreground hover:text-foreground hover:underline">
              Download rules acceptance JSON
            </button>
          </div>

          <VerificationPanel
            hostelId={hostelId}
            tenantId={tenantId}
            profileType={profileType}
            documents={documents}
            photoUrl={photoUrl}
            onUpdated={onDocumentsUpdated}
          />
        </div>
      ) : (
        <DocumentsHub
          tenantId={tenantId}
          hasAgreement={hasAgreement}
          agreementUrl={null}
          recentPayments={recentPayments}
          recentChanges={recentChanges}
          onViewAllChanges={onViewAllChanges}
        />
      )}
    </div>
  );
}
