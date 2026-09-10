import { describe, it, expect } from 'vitest';
import { buildTenantNav } from './tenantNav';
import { ACTIVE_TENANT_TABS } from './appNavConfig';

describe('buildTenantNav', () => {
  it('matches ACTIVE_TENANT_TABS exactly (destinations and order)', () => {
    const navPaths = buildTenantNav().flatMap((g) => g.items).map((i) => i.to);
    expect(navPaths).toEqual(ACTIVE_TENANT_TABS.map((t) => t.to));
  });

  it('reuses the same icons as the mobile bottom nav', () => {
    const navItems = buildTenantNav().flatMap((g) => g.items);
    for (const tab of ACTIVE_TENANT_TABS) {
      expect(navItems.find((i) => i.to === tab.to)?.icon).toBe(tab.Icon);
    }
  });

  it('marks only Home as an exact match', () => {
    const items = buildTenantNav().flatMap((g) => g.items);
    expect(items.filter((i) => i.end).map((i) => i.to)).toEqual(['/tenant/home']);
  });
});
