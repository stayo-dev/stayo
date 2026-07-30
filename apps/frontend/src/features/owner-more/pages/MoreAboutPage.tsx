import { ListRow } from '@shared/ui-patterns/ListRow';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { mockAbout } from '@shared/mocks/more';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/** More → About StayO. Not in Stayo App.dc.html's design source — added per explicit request, same visual pattern as the rest of More/Settings. */
export function MoreAboutPage() {
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="More" title="About StayO" />

      <div className="flex flex-col items-center gap-1.5 py-4 text-center">
        <span className="font-display text-lg font-extrabold text-primary">Stayo</span>
        <span className="font-display text-sm font-bold text-foreground">{mockAbout.version}</span>
        <span className="text-xs text-muted-foreground">{mockAbout.tagline}</span>
      </div>

      <div className={card}>
        <ListRow title="Privacy Policy" showChevron onClick={() => stayoToast.info('Coming soon')} className="px-4" />
        <ListRow title="Terms of Service" showChevron onClick={() => stayoToast.info('Coming soon')} className="px-4" />
        <ListRow title="Licenses" showChevron onClick={() => stayoToast.info('Coming soon')} className="px-4" />
      </div>
    </div>
  );
}
