export interface RoomTypePricing {
  roomType: string;
  capacity: number;
  baseRent: number;
  availableBeds: number;
  occupiedCount: number;
  totalRoomsCount: number;
  photos: string[];
}

export interface LandingAvailability {
  bedsAvailable: number;
  totalBeds: number;
  occupiedBeds: number;
  reservedBeds: number;
  occupancyRate?: number;
  startingPrice: number;
  sharingTypes: string[];
  roomTypes: RoomTypePricing[];
  intakeMonth: string;
  visitUrl: string;
  hasLiveAvailability: boolean;
}
