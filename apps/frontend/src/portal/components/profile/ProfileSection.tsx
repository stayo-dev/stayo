import type { ReactNode } from 'react';

export function ProfileSection({
  id,
  title,
  description,
  children,
  readOnly = false,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  readOnly?: boolean;
}) {
  return (
    <section
      id={id}
      className={`rounded-2xl border p-4 ${readOnly ? 'border-border bg-secondary/40' : 'border-border bg-card'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {readOnly && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 shrink-0">
            Read only
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

export function ProfileRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-sm border-b border-border/60 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-foreground text-right break-all">{value ?? '—'}</span>
    </div>
  );
}

