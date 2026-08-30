import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { hasChanges } from '../config/dirtyState';

const card = 'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** Configuration > Finance > Receipts > footer — the one real, wired receipt-customization field (policy.receipts.footer). */
export function MoreConfigReceiptFooterPage() {
  const navigate = useNavigate();
  
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const [footer, setFooter] = useState('');
  /** What was loaded — Save appears only while the text differs from it. */
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    const existing = policyQuery.data?.policy?.receipts?.footer;
    if (existing !== undefined) {
      setFooter(existing);
      setBaseline(existing);
    }
  }, [policyQuery.data]);

  const dirty = hasChanges(baseline, footer);

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      { receipts: { footer } },
      {
        onSuccess: () => {
          stayoToast.success('Receipt footer saved');
          navigate('/owner/more/configuration/finance');
        },
        onError: () => stayoToast.error('Could not save receipt footer'),
      },
    );
  };

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader backTo="/owner/more/configuration/finance" backLabel="Finance" title="Receipt footer" subtitle="Shown at the bottom of every generated receipt" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Footer text</span>
        <div className={card}>
          <textarea
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            rows={4}
            placeholder="This is a computer-generated receipt…"
            className="w-full resize-none bg-transparent px-4 py-3.5 text-[13.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => setFooter(baseline ?? '')}
        label="Save receipt footer"
      />
    </div>
  );
}
