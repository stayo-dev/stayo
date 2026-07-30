import { ChevronLeft } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

/**
 * Configuration sub-app shell, per Stayo Config.dc.html. The design drives
 * this screen with a navigation *stack* (push/pop), not tabs — implemented
 * here as nested routes instead (see the foundation plan's routing
 * rationale). The dashboard root (`/owner/config`) shows the shared owner
 * bottom nav per the design ("Configure" tab, active); every nested
 * sub-screen (finance, agreements, etc.) shows a back-header instead,
 * matching the design's stack-navigation chrome.
 */
export function ConfigShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDashboardRoot = location.pathname === '/owner/config';

  return (
    <ThemeProvider theme="product">
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        {!isDashboardRoot && (
          <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background px-4 py-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border"
              aria-label="Back"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <Link to="/owner/config" className="text-sm font-semibold text-muted-foreground">
              Configuration
            </Link>
          </header>
        )}

        <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))]">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </ThemeProvider>
  );
}
