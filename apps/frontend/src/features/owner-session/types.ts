export interface OwnerSessionHostel {
  id: string;
  name: string;
}

export interface OwnerSession {
  ownerId: string | null;
  ownerName: string | null;
  hostels: OwnerSessionHostel[];
  primaryHostelId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/** The contract every concrete session adapter must satisfy. */
export type OwnerSessionAdapter = () => OwnerSession;
