import { lazy } from 'react';
import { Route } from 'react-router-dom';
import { RouteScaffold } from '@/app/components/RouteScaffold';
import { OwnerBoundary } from './OwnerRoutes';

const ConfigShell = lazy(() =>
  import('@/app/layouts/ConfigShell').then((m) => ({ default: m.ConfigShell })),
);

/**
 * StayO Configuration sub-app, per Stayo Config.dc.html's navigation stack
 * (dashboard -> finance/agreements/hostel/automation/notifications/account),
 * implemented as nested routes under ConfigShell — see that file for how the
 * design's stack-navigation maps to real routing. Placeholders only, no
 * feature UI yet.
 */
export function ConfigRoutes() {
  return (
    <Route element={<OwnerBoundary />}>
      <Route element={<ConfigShell />}>
        <Route path="/owner/config" element={<RouteScaffold label="Configuration · Dashboard" />} />
        <Route path="/owner/config/finance" element={<RouteScaffold label="Configuration · Finance" />} />
        <Route path="/owner/config/finance/late-fees" element={<RouteScaffold label="Configuration · Late Fees" />} />
        <Route path="/owner/config/finance/gateway" element={<RouteScaffold label="Configuration · Payment Gateway" />} />
        <Route path="/owner/config/agreements" element={<RouteScaffold label="Configuration · Agreements" />} />
        <Route path="/owner/config/agreements/templates" element={<RouteScaffold label="Configuration · Agreement Templates" />} />
        <Route path="/owner/config/agreements/templates/:templateId" element={<RouteScaffold label="Configuration · Template Preview" />} />
        <Route path="/owner/config/agreements/clauses" element={<RouteScaffold label="Configuration · Clause Library" />} />
        <Route path="/owner/config/hostel" element={<RouteScaffold label="Configuration · Hostel" />} />
        <Route path="/owner/config/automation" element={<RouteScaffold label="Configuration · Automation" />} />
        <Route path="/owner/config/notifications" element={<RouteScaffold label="Configuration · Notifications" />} />
        <Route path="/owner/config/account" element={<RouteScaffold label="Configuration · Account & Team" />} />
      </Route>
    </Route>
  );
}
