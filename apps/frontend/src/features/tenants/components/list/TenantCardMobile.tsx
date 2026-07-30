import { useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { TenantCard } from './TenantCard';
import type { NormalizedTenant } from '@features/tenants/utils/normalize';

interface Props {
  tenants: NormalizedTenant[];
  hostelId: string;
  onSelect?: (t: NormalizedTenant) => void;
  onReminder?: (t: NormalizedTenant) => void;
  onCall?: (phone: string) => void;
  onResend?: (t: NormalizedTenant) => void;
  selectedIds?: Set<string>;
  onToggleSelect?: (tenantId: string) => void;
}

export function TenantCardMobile({
  tenants,
  onSelect,
  onReminder,
  onResend,
  selectedIds,
  onToggleSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const updateOffset = () => {
      const node = listRef.current;
      if (!node) return;
      const scrollContainer = node.closest('main');
      if (!scrollContainer) return;
      const rect = node.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const offset = rect.top - containerRect.top + scrollContainer.scrollTop;
      if (Math.abs(scrollMargin - offset) > 1) {
        setScrollMargin(offset);
      }
    };

    updateOffset();
    window.addEventListener('resize', updateOffset);
    return () => window.removeEventListener('resize', updateOffset);
  });

  const virtualizer = useVirtualizer({
    count: tenants.length,
    getScrollElement: () => listRef.current?.closest('main') || null,
    estimateSize: () => 120,
    overscan: 5,
    scrollMargin,
  });

  if (tenants.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-12 md:hidden">No tenants found</p>
    );
  }

  return (
    <div
      ref={listRef}
      className="md:hidden relative"
      style={{ height: virtualizer.getTotalSize() - scrollMargin }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const tenant = tenants[virtualRow.index];
        return (
          <div
            key={tenant.id}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 right-0 pb-3 px-4"
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            <TenantCard
              tenant={tenant}
              mode="hostel"
              selected={selectedIds?.has(tenant.id) ?? false}
              onToggleSelect={onToggleSelect}
              onSelect={onSelect}
              onCollect={onSelect} // Trigger same select/view flow
              onReminder={onReminder}
              onResend={onResend}
            />
          </div>
        );
      })}
    </div>
  );
}
