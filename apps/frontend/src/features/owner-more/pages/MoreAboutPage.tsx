import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { mockAbout } from '@shared/mocks/more';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

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

/** More → About Stayo. Not in Stayo App.dc.html's design source — added per explicit request, same visual pattern as the rest of More/Settings. */
export function MoreAboutPage() {
  const navigate = useNavigate();
  const [licensesOpen, setLicensesOpen] = useState(false);

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="More" title="About Stayo" />

      <div className="flex flex-col items-center gap-1.5 py-4 text-center">
        <span className="font-display text-lg font-extrabold text-primary">Stayo</span>
        <span className="font-display text-sm font-bold text-foreground">{mockAbout.version}</span>
        <span className="text-xs text-muted-foreground">{mockAbout.tagline}</span>
      </div>

      <div className={card}>
        <ListRow title="Privacy Policy" showChevron onClick={() => navigate('/legal/privacy')} className="px-4" />
        <ListRow title="Terms of Service" showChevron onClick={() => navigate('/legal/terms')} className="px-4" />
        <ListRow title="Licenses" showChevron onClick={() => setLicensesOpen(true)} className="px-4" />
      </div>

      <BottomSheet open={licensesOpen} onOpenChange={setLicensesOpen} title="Licenses">
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Stayo is built with the following open-source software, each distributed under its own license:
          </p>
          <div className="overflow-hidden rounded-2xl border border-border">
            {OPEN_SOURCE_LIBS.map((lib) => (
              <div key={lib.name} className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-[13px] last:border-none">
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
