import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye } from 'lucide-react';
import { ListingPage } from '@/app/pages/discover/ListingPage';
import { DiscoverAuthProvider } from '@/app/pages/discover/DiscoverAuthContext';

/**
 * Admin preview of a submitted marketing page, rendered by the REAL Discovery
 * listing component so what is approved is exactly what tenants will see.
 *
 * The banner is the only thing added — without it an admin could mistake an
 * unapproved draft for the live page.
 *
 * Wrapped in DiscoverAuthProvider because ListingPage calls useDiscoverAuth
 * for its enquiry CTA, and that hook throws outside the Discovery tree. The
 * provider is self-contained state plus a sign-in modal, so supplying it here
 * is cheaper and safer than making the hook tolerate a missing provider —
 * that guard exists to catch exactly this mistake on the public side.
 */
export function ListingPreviewPage() {
  const { revisionId } = useParams<{ revisionId: string }>();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-50 flex items-center gap-3 bg-[#221E1A] px-4 py-2.5 text-white sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/admin/listings?tab=content')}
          className="flex flex-none items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-[12px] font-semibold hover:bg-white/15"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
          Back to review
        </button>
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#E0A97F]">
          <Eye className="h-3.5 w-3.5" strokeWidth={2} />
          Preview — not published
        </span>
        <span className="hidden text-[11.5px] text-[#B9AFA3] sm:block">
          Exactly how this will appear on Discovery if you approve it.
        </span>
      </div>
      <DiscoverAuthProvider>
        <ListingPage previewRevisionId={revisionId} />
      </DiscoverAuthProvider>
    </div>
  );
}
