import { useQuery } from '@tanstack/react-query';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/app/components/ui/sheet';
import { paymentService } from '@features/payments/api';
import { getEventDisplay, TONE_DOT_CLASSES, TONE_ICON_CLASSES, type TimelineEvent } from '@features/tenants/utils/financialColors';
import { StayoLoader } from '@shared/ui/brand';

const fmt = (n: number) => `₹${Number(n ?? 0).toLocaleString('en-IN')}`;

interface ObligationHistorySheetProps {
  obligationId: string | null;
  label: string;
  onClose: () => void;
}

export function ObligationHistorySheet({ obligationId, label, onClose }: ObligationHistorySheetProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['obligation-history', obligationId],
    queryFn: () => paymentService.getObligationHistory(obligationId as string),
    enabled: Boolean(obligationId),
  });

  const events: TimelineEvent[] = data?.events ?? (Array.isArray(data) ? data : []);

  return (
    <Sheet open={Boolean(obligationId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Charge History</SheetTitle>
          <SheetDescription>{label}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6 overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <StayoLoader size="md" className="text-accent" />
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-10">No history recorded for this charge.</p>
          ) : (
            <div className="relative pl-5 border-l border-border space-y-4 ml-1">
              {events.map((event) => {
                const { label: eventLabel, icon: Icon, tone } = getEventDisplay(event);
                return (
                  <div key={event.id} className="relative text-xs">
                    <span className={`absolute -left-[26px] top-1 w-2.5 h-2.5 rounded-full border-2 border-card ${TONE_DOT_CLASSES[tone]}`} />
                    <div className="flex items-start gap-2">
                      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${TONE_ICON_CLASSES[tone]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground">{eventLabel}</span>
                          {event.amount != null && (
                            <span className="font-bold text-foreground shrink-0">{fmt(Math.abs(event.amount))}</span>
                          )}
                        </div>
                        <p className="text-muted-foreground mt-0.5">{event.summary}</p>
                        <p className="text-[10px] text-muted-foreground/80 mt-1 font-medium">
                          {new Date(event.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
