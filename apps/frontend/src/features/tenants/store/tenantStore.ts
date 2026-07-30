import { create } from 'zustand';

export type LifecycleFilter =
  | 'all'
  | 'active'
  | 'invited'
  | 'move_out'
  | 'overdue'
  | 'unverified'
  | 'no_room'
  | 'inactive';

export type ActiveDrawer = 'invite' | 'profile' | 'transfer' | 'payment' | 'move_out' | null;

interface TenantStore {
  selectedHostelId: string | null;
  selectedTenantId: string | null;
  searchQuery: string;
  lifecycleFilter: LifecycleFilter;
  showInactive: boolean;
  activeDrawer: ActiveDrawer;
  page: number;
  pageSize: number;

  setSelectedHostelId: (id: string | null) => void;
  setSelectedTenantId: (id: string | null) => void;
  setSearchQuery: (q: string) => void;
  setLifecycleFilter: (f: LifecycleFilter) => void;
  setShowInactive: (v: boolean) => void;
  setActiveDrawer: (d: ActiveDrawer) => void;
  setPage: (p: number) => void;
  resetFilters: () => void;
}

export const useTenantStore = create<TenantStore>((set) => ({
  selectedHostelId: null,
  selectedTenantId: null,
  searchQuery: '',
  lifecycleFilter: 'all',
  showInactive: false,
  activeDrawer: null,
  page: 0,
  pageSize: 25,

  setSelectedHostelId: (id) => set({ selectedHostelId: id }),
  setSelectedTenantId: (id) => set({ selectedTenantId: id }),
  setSearchQuery: (q) => set({ searchQuery: q, page: 0 }),
  setLifecycleFilter: (f) => set({ lifecycleFilter: f, page: 0 }),
  setShowInactive: (v) => set({ showInactive: v, page: 0 }),
  setActiveDrawer: (d) => set({ activeDrawer: d }),
  setPage: (p) => set({ page: p }),
  resetFilters: () =>
    set({
      searchQuery: '',
      lifecycleFilter: 'all',
      showInactive: false,
      page: 0,
    }),
}));
