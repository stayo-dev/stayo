import { MessageCircle, Bug, Mail } from 'lucide-react';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { mockFaqs } from '@shared/mocks/more';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** More → Help & Support. Not in Stayo App.dc.html's design source — added per explicit request, same visual pattern as the rest of More/Settings. */
export function MoreHelpPage() {
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="More" title="Help & Support" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Frequently asked</span>
        <div className={card}>
          {mockFaqs.map((f) => (
            <div key={f.id} className="border-b border-border/60 px-4 py-3.5 last:border-none">
              <div className="text-[13.5px] font-semibold text-foreground">{f.question}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{f.answer}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary text-primary">
              <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Contact Support"
          meta="Chat with the Stayo team"
          showChevron
          onClick={() => stayoToast.info('Coming soon')}
          className="px-4"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary text-primary">
              <Bug className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Report a Bug"
          meta="Tell us what went wrong"
          showChevron
          onClick={() => stayoToast.info('Coming soon')}
          className="px-4"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary text-primary">
              <Mail className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Email us"
          meta="support@stayo.app"
          showChevron
          onClick={() => stayoToast.info('Coming soon')}
          className="px-4"
        />
      </div>
    </div>
  );
}
