import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCenter } from '@features/help-center/components/HelpCenter';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const OPEN_SOURCE_LIBS = [
  { name: 'React & React DOM', license: 'MIT' },
  { name: 'React Router', license: 'MIT' },
  { name: 'Vite', license: 'MIT' },
  { name: 'Tailwind CSS', license: 'MIT' },
  { name: 'Radix UI', license: 'MIT' },
  { name: 'TanStack Query', license: 'MIT' },
  { name: 'Vaul', license: 'MIT' },
  { name: 'Lucide icons', license: 'ISC' },
];

/**
 * Profile → Help.
 *
 * Previously a list of mock FAQs above two rows that both raised a "Coming
 * soon" toast — so an owner who hit a real bug had no way to tell anyone, and
 * `platform_support_tickets` had never received a single row. The endpoint had
 * been role-agnostic the whole time; only the button was missing. It is now
 * the same Help Centre the tenant side gets, with the owner's own catalogue:
 * listing review, payouts, invites, service requests.
 *
 * **About folded in here.** It was its own row on Profile and its own screen,
 * carrying three links and a version number read from `@shared/mocks` — so a
 * shipped screen stated a made-up version of the app. The three links are real
 * and are kept, at the foot of the one screen an owner already opens when they
 * want to know something about Stayo rather than about their hostel. The
 * mocked version and tagline are dropped rather than replaced with another
 * invented number: there is no build-version source wired through to the
 * frontend, and a plausible-looking wrong one is worse than none.
 *
 * `chrome="embedded"` suppresses `HelpCenter`'s own header so this screen's
 * `MoreScreenHeader` is the only one — the component renders a full-screen
 * header of its own otherwise.
 */
export function MoreHelpPage() {
  const navigate = useNavigate();
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="Profile" title="Help" />

      <HelpCenter audience="owner" chrome="embedded" />

      <section className="flex flex-col gap-1.5">
        <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          About Stayo
        </h2>
        <div className="overflow-hidden rounded-[14px] border border-border bg-card">
          <ListRow title="Privacy Policy" showChevron onClick={() => navigate('/legal/privacy')} className="px-4" />
          <ListRow
            title="Terms of Service"
            showChevron
            onClick={() => navigate('/legal/terms')}
            className="border-t border-border/60 px-4"
          />
          <ListRow
            title="Licenses"
            showChevron
            onClick={() => setLicensesOpen(true)}
            className="border-t border-border/60 px-4"
          />
        </div>
      </section>

      <BottomSheet open={licensesOpen} onOpenChange={setLicensesOpen} title="Licenses">
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Stayo is built with the following open-source software, each distributed under its own
            license:
          </p>
          <div className="overflow-hidden rounded-2xl border border-border">
            {OPEN_SOURCE_LIBS.map((lib) => (
              <div
                key={lib.name}
                className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-[13px] last:border-none"
              >
                <span className="font-semibold text-foreground">{lib.name}</span>
                <span className="text-muted-foreground">{lib.license}</span>
              </div>
            ))}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
