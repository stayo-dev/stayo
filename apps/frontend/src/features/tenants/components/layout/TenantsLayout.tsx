import { Outlet, Link } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';

interface Props {
  title?: string;
  subtitle?: string;
  backTo?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}

export function TenantsLayout({ title, subtitle, backTo, actions, children }: Props) {
  return (
    <div className="px-4 py-5 space-y-5 min-w-0 max-w-5xl mx-auto pb-24 md:pb-8">
      <header className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0 flex-1">
          {backTo && (
            <Link
              to={backTo}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
          )}
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-accent" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground truncate">{title ?? 'Tenants'}</h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground truncate">{subtitle}</p>
              )}
            </div>
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </header>
      {children ?? <Outlet />}
    </div>
  );
}
