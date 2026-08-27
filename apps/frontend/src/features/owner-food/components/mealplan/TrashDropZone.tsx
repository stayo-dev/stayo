import { Trash2 } from 'lucide-react';

interface TrashDropZoneProps {
  visible: boolean;
  hovering: boolean;
  registerRect: (el: HTMLDivElement | null) => void;
}

/**
 * Fixed, page-level drop zone a placed chip is dragged onto to delete it
 * (ADR-123) — mounted always (so its rect is measurable via `gridMeasure`),
 * only visually shown while a chip drag is in progress. The tap-× on
 * `PlacedChip` stays as the accessible fallback; this is the drag alternative.
 */
export function TrashDropZone({ visible, hovering, registerRect }: TrashDropZoneProps) {
  return (
    <div
      ref={registerRect}
      aria-hidden={!visible}
      className={`fixed bottom-5 left-1/2 z-50 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 transition-all duration-150 ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      } ${hovering ? 'scale-110 border-destructive bg-destructive text-destructive-foreground' : 'scale-100 border-border bg-card text-muted-foreground'}`}
    >
      <Trash2 className="h-5 w-5" />
    </div>
  );
}
