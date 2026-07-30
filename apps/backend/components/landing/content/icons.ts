import {
  Bed,
  Building2,
  Cctv,
  Droplet,
  FileCheck,
  Home,
  Key,
  Lock,
  Phone,
  Shield,
  Sparkles,
  UtensilsCrossed,
  WashingMachine,
  Wifi,
  Zap,
  MapPin,
} from 'lucide-react';

export const landingIconMap = {
  bed: Bed,
  building: Building2,
  cctv: Cctv,
  cleaning: Sparkles,
  document: FileCheck,
  food: UtensilsCrossed,
  home: Home,
  key: Key,
  laundry: WashingMachine,
  location: MapPin,
  phone: Phone,
  power: Zap,
  security: Shield,
  storage: Lock,
  water: Droplet,
  wifi: Wifi,
};

export function getLandingIcon(name: string | undefined, fallback: keyof typeof landingIconMap = 'home') {
  return landingIconMap[(name || fallback) as keyof typeof landingIconMap] || landingIconMap[fallback];
}
