import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => (
  <Sonner
    theme="light"
    className="toaster group"
    toastOptions={{
      classNames: {
        toast: 'group toast rounded-xl shadow-lg border text-sm',
        title: 'font-semibold text-foreground',
        description: 'text-muted-foreground text-xs mt-0.5 leading-relaxed',
        actionButton: 'bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-lg',
        cancelButton: 'bg-muted text-muted-foreground text-xs px-3 py-1.5 rounded-lg',
        error: 'border-red-200 bg-red-50 [&_[data-title]]:text-red-800 [&_[data-description]]:text-red-600',
        success: 'border-emerald-200 bg-emerald-50 [&_[data-title]]:text-emerald-800 [&_[data-description]]:text-emerald-600',
        warning: 'border-amber-200 bg-amber-50 [&_[data-title]]:text-amber-800 [&_[data-description]]:text-amber-600',
        info: 'border-blue-200 bg-blue-50 [&_[data-title]]:text-blue-800 [&_[data-description]]:text-blue-600',
        loading: 'border-border bg-card',
      },
    }}
    style={
      {
        '--normal-bg': 'var(--card)',
        '--normal-text': 'var(--card-foreground)',
        '--normal-border': 'var(--border)',
      } as React.CSSProperties
    }
    {...props}
  />
);

export { Toaster };
