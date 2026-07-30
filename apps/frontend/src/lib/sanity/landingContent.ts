export type MarketingImage = {
  url: string;
  alt: string;
  caption?: string;
};

export type LandingCta = {
  label: string;
  href: string;
};

export type LandingAnnouncement = {
  title: string;
  description?: string;
  cta?: LandingCta;
  startDate?: string;
  endDate?: string;
  priority?: number;
};

export type HostelProfileContent = {
  name: string;
  phone?: string;
  whatsappNumber?: string;
  email?: string;
  shortLocation?: string;
  addressLines?: string[];
  locationTitle?: string;
  locationDescription?: string;
  distanceTitle?: string;
  distanceDescription?: string;
  googleMapsUrl?: string;
  googleMapsEmbedUrl?: string;
  ownerName?: string;
  ownerMessage?: string;
  ownerPhoto?: MarketingImage;
};

export type TourVideoContent = {
  id: string;
  label: string;
  url: string;
  mobileUrl?: string;
  poster?: string;
  icon: 'bed' | 'building' | 'utensils' | 'tv' | 'wifi' | 'security';
};

export type HeroContent = {
  title: string;
  subtitle: string;
  supportingCopy?: string;
  trustBadge?: string;
  highlights: string[];
  primaryCta?: LandingCta;
  secondaryCta?: LandingCta;
  primaryCtaText?: string;
  secondaryCtaText?: string;
  ownerImage?: MarketingImage;
  carouselImages: MarketingImage[];
  tourVideos?: TourVideoContent[];
};

export type FeatureContent = {
  title: string;
  description: string;
  icon: string;
  image?: MarketingImage;
  bulletPoints?: string[];
};

export type FacilityContent = {
  title: string;
  icon: string;
  description?: string;
};

export type TestimonialContent = {
  name: string;
  role?: string;
  review: string;
  rating: number;
  type?: 'student' | 'parent';
  image?: MarketingImage;
};

export type FaqContent = {
  question: string;
  answer: string;
};

export type AdmissionStepContent = {
  step: number;
  stepNumber?: number;
  title: string;
  description: string;
  icon?: string;
};

export type SeoContent = {
  title: string;
  description: string;
  canonicalUrl?: string;
  ogImage?: MarketingImage;
};

export type FooterContent = {
  title: string;
  description?: string;
  quickLinks: LandingCta[];
  copyright?: string;
};

export type GalleryImageContent = MarketingImage & {
  title?: string;
  category?: string;
};

export type LandingMarketingContent = {
  hostelProfile: HostelProfileContent;
  seo: SeoContent;
  hero: HeroContent;
  announcements: LandingAnnouncement[];
  features: FeatureContent[];
  facilities: FacilityContent[];
  testimonials: TestimonialContent[];
  faqs: FaqContent[];
  gallery: GalleryImageContent[];
  admissionSteps: AdmissionStepContent[];
  footer: FooterContent;
  announcementBarEnabled?: boolean;
  announcementBarText?: string;
  announcementBarLinkText?: string;
  statsStrip?: { value: string; label: string }[];
  roomInclusions?: string[];
  totalCostClarityText?: string;
  contactFormButtonText?: string;
  roomTypeTitle?: string;
  roomImage?: MarketingImage;
  startingPrice?: number;
  bedsAvailable?: number;
  intakeMonth?: string;
  hostelAvailability?: {
    bedsAvailable: number | null;
    intakeMonth: string | null;
  };
};

const fallbackImages = {
  room: '/SAH_Room.webp',
  food: '/Hostel_Galary_Food_chicken_birany.webp',
  building: '/SAH_Hostel_Galary_Building.webp',
};

export const fallbackLandingContent: LandingMarketingContent = {
  hostelProfile: {
    name: 'StayO',
    phone: '0000000000',
    whatsappNumber: '910000000000',
    email: 'support@stayo.app',
    shortLocation: '[City — TBD]',
    addressLines: ['StayO', '[Registered address — TBD]'],
    locationTitle: 'Prime Location',
    locationDescription: 'Conveniently located near SNIST — your daily commute is just a 5-minute walk',
    distanceTitle: 'Just 400m from SNIST',
    distanceDescription: '5 minute walk to campus gate',
    googleMapsUrl: 'https://maps.google.com/',
    googleMapsEmbedUrl: /* TODO: real StayO map embed */
      'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d951.5284365512007!2d78.66220596962678!3d17.454269078321268!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3bcb770dd641583b%3A0xde3e95b9afb8c1b1!2sSri%20Adithya%20Boys%20Hostel!5e0!3m2!1sen!2sin!4v1780503771881!5m2!1sen!2sin',
    ownerName: 'StayO Team',
    ownerMessage: 'I personally respond to every enquiry.',
    ownerPhoto: { url: '/hostel_icon.png', alt: 'StayO Logo' },
  },
  seo: {
    title: 'Best Student Hostels | StayO',
    description:
      'Best Boys Hostel near SNIST with Home Food, Wi-Fi, CCTV security, and single/sharing room options. Walkable distance to SNIST college.',
    canonicalUrl: 'https://stayo.app/',
  },
  hero: {
    title: '5 Minutes from SNIST Gate.',
    subtitle: 'Safe living. Homely food. All-inclusive.',
    supportingCopy: 'Admissions Open — ₹8,200/month, everything included.',
    trustBadge: 'Trusted by SNIST students since 2019',
    highlights: ['Meals Included', 'CCTV + Warden', '400m from SNIST'],
    primaryCta: { label: 'Book a Room Visit', href: '#contact' },
    secondaryCta: { label: 'Check Availability on WhatsApp', href: 'https://api.whatsapp.com/send?phone=910000000000' },
    ownerImage: { url: '/hostel_icon.png', alt: 'StayO Logo' },
    carouselImages: [
      { url: '/SAH_Hostel_Galary_Building.webp', alt: 'Hostel Building', caption: 'Hostel Building' },
      { url: '/SAH_Room.webp', alt: 'Room', caption: '4-Sharing Room' },
      { url: '/SAH_Hostel_Galary_Common_area.webp', alt: 'Common Area', caption: 'Common Area' },
      { url: '/Hostel_Galary_Room_interior.webp', alt: 'Room Interior', caption: 'Room Interior' },
      { url: '/Hostel_Galary_Food_chicken_birany.webp', alt: 'Chicken Biryani', caption: 'Chicken Biryani' },
    ],
    tourVideos: [
      {
        id: 'common',
        label: 'Hostel Tour',
        url: '/SAH_Common_desktop.mp4',
        mobileUrl: '/SAH_Common_mobile.mp4',
        poster: '/SAH_Common_poster.webp',
        icon: 'building',
      },
      {
        id: 'room',
        label: 'Room Interior',
        url: '/SAH_Room_desktop.mp4',
        mobileUrl: '/SAH_Room_mobile.mp4',
        poster: '/SAH_Room_poster.webp',
        icon: 'bed',
      },
      {
        id: 'dining',
        label: 'Dining Hall',
        url: '/SAH_Dining_desktop.mp4',
        mobileUrl: '/SAH_Dining_mobile.mp4',
        poster: '/SAH_Dining_poster.webp',
        icon: 'utensils',
      },
    ],
  },
  announcements: [],
  features: [
    {
      icon: 'utensils',
      title: 'Homely Food',
      description: "Fresh, daily meals included — just like mom's cooking",
      image: { url: fallbackImages.food, alt: 'Homely food served at StayO' },
      bulletPoints: [
        '3 Hot Meals Daily (Breakfast, Lunch & Dinner)',
        'Sunday Special Meals & festive celebrations',
        'RO Purified drinking water & clean kitchen',
      ],
    },
    {
      icon: 'home',
      title: 'Homely Atmosphere',
      description: 'Warm, safe & comfortable — designed for students',
      image: { url: fallbackImages.room, alt: 'Student room at StayO' },
      bulletPoints: [
        'Upgraded to 100 Mbps high-speed WiFi in every room',
        'Daily housekeeping & room cleaning',
        '24/7 hot water availability',
      ],
    },
    {
      icon: 'map-pin',
      title: 'Prime Location',
      description: '400m from SNIST gate — walk in 5 minutes',
      image: { url: fallbackImages.building, alt: 'StayO building location' },
      bulletPoints: [
        'Only 400m from SNIST gate (3 min walk)',
        'Safe well-lit walking path for students',
        'Close to shops, clinics & transport',
      ],
    },
  ],
  facilities: [
    { icon: 'utensils', title: 'Meals Included' },
    { icon: 'wifi', title: 'Free WiFi' },
    { icon: 'droplet', title: 'Hot Water' },
    { icon: 'sparkles', title: 'Daily Cleaning' },
    { icon: 'shield', title: 'Warden Security' },
    { icon: 'camera', title: '24/7 CCTV' },
    { icon: 'shirt', title: 'Washing Machine' },
    { icon: 'lock', title: 'Secure Storage' },
    { icon: 'zap', title: 'Emergency Generator' },
    { icon: 'arrow-up-square', title: 'Lift Available' },
  ],
  testimonials: [
    {
      name: 'Afreed',
      role: '3rd Year · B.Tech CSE · SNIST',
      review: "The best part about this accommodation is the food it's homely, hygienic, and served on time every day. The management and Specially Thatayya👴 are very approachable and ensure all our needs are met quickly. It really feels like a home away from home",
      rating: 5,
    },
    {
      name: 'Harsha',
      role: '3nd Year · B.Tech ECE · SNIST',
      review: '5 minutes to college gate. I sleep until 8:30 for a 9 AM class. Its biggest Advantage of staying in this hostel for me.',
      rating: 5,
    },
    {
      name: 'Father of Shiva',
      role: 'Parent · Verified Stay',
      review: 'My biggest worry was food. After visiting once and seeing the kitchen, I stopped worrying. They also WhatsApp me if anything unusual happens.',
      rating: 5,
    },
    {
      name: 'Kuldeep reddy (Google Review)',
      role: 'Parent · Verified Stay',
      review: "My brother resided in the hostel actually\nFood was great and hostel was maintained hygienely through out the three years\nIt's rare to find such a college boys hostel",
      rating: 5,
    },
  ],
  faqs: [
    {
      question: 'What kind of food is served and how is quality maintained?',
      answer: 'We serve 3 hot, hygienic meals daily (Breakfast, Lunch & Dinner) prepared by professional cooks on site. Highlights include special Sunday Chicken biryani and Paneer Biryani. We only use RO purified drinking water and maintain clean, sanitised kitchen premises.',
    },
    {
      question: 'What happens during semester breaks and summer vacation?',
      answer: 'Students are usually required to vacate the hostel during Summer Holidays, Sankranthi, and Dasara breaks. We use this time for maintenance and facility improvements. Vacation schedules are communicated in advance, and we are always available on WhatsApp for any assistance or clarification.',
    },
    {
      question: 'How far is the hostel from SNIST and how do students commute?',
      answer: 'The hostel is located just 400 metres from the SNIST main gate. It is a safe 3-to-5-minute walk along a well-lit path, eliminating any need for auto or bus travel for daily classes.',
    },
    {
      question: 'What security measures are in place for students?',
      answer: 'We take student safety very seriously. The hostel has 24/7 CCTV surveillance across all corridors and entry points, a secure biometric gate control system, and the warden/owner resides on-site to assist students at any hour.',
    },
    {
      question: 'Is high-speed Wi-Fi available for online classes and study?',
      answer: 'Yes, we provide free high-speed commercial Wi-Fi coverage across all rooms and common study areas to ensure SNIST students can study and work on projects without interruption.',
    },
    {
      question: 'What happens in case of a medical emergency?',
      answer: 'The warden resides on the premises and has emergency transport ready 24/7. We maintain a basic first-aid kit, have access to nearby clinics, and immediately coordinate with parents.',
    },
    {
      question: 'Are power backup facilities available?',
      answer: 'Yes, we have power backup systems installed for basic lights, fans, and Wi-Fi router operations so that studies are not disrupted during power cuts.',
    },
    {
      question: 'Is the hostel suitable for parents who want regular safety updates?',
      answer: 'Yes. Parents can speak with the owner and understand rules, safety, and visit process before admission. We provide regular updates to parents.',
    },
    {
      question: 'Are there hidden charges?',
      answer: 'No. Room pricing and inclusions are discussed clearly before admission confirmation.',
    },
    {
      question: 'Can we visit the hostel before confirming admission?',
      answer: 'Absolutely. We encourage all students and parents to visit in person. Call or WhatsApp the StayO team at 00000-00000 to schedule a visit — most visits happen within 24 hours of enquiry.',
    },
  ],
  gallery: [
    { url: '/SAH_Hostel_Galary_Building.webp', alt: 'Hostel Building', caption: 'Hostel Building' },
    { url: '/SAH_Room.webp', alt: 'Room', caption: '4-Sharing Room' },
    { url: '/SAH_Hostel_Galary_Common_area.webp', alt: 'Common Area', caption: 'Common Area' },
    { url: '/Hostel_Galary_Room_interior.webp', alt: 'Room Interior', caption: 'Room Interior' },
    { url: '/Hostel_Galary_Food_chicken_birany.webp', alt: 'Chicken Biryani', caption: 'Chicken Biryani' },
  ],
  admissionSteps: [
    { stepNumber: 1, title: 'Reach Out', description: 'Call or WhatsApp the StayO team — get answers in minutes.' },
    { stepNumber: 2, title: 'Visit the Hostel', description: 'Come see the room, food, and facilities in person.' },
    { stepNumber: 3, title: 'Pick Your Room', description: 'Select your preferred block and bed. We show you who your roommates are.' },
    { stepNumber: 4, title: 'Pay & Confirm', description: 'Simple deposit to reserve your bed. No hidden charges.' },
    { stepNumber: 5, title: 'Move In', description: 'Bring your things. Your home near SNIST is ready.' },
  ],
  footer: {
    title: 'StayO',
    description: 'Your home away from home — providing comfortable, safe, and affordable accommodation for students near SNIST.',
    quickLinks: [
      { label: 'Home', href: '#home' },
      { label: 'Facilities', href: '#facilities' },
      { label: 'Rooms & Pricing', href: '#rooms' },
      { label: 'Location', href: '#location' },
      { label: 'Contact', href: '#contact' },
      { label: 'Tenant / Owner Login', href: '/login' },
    ],
    copyright: '© 2026 StayO. All rights reserved.',
  },
  startingPrice: 8200,
  announcementBarEnabled: true,
  announcementBarText: 'Admissions Open — Only 40 beds available for July intake. Filling fast.',
  announcementBarLinkText: 'Reserve now →',
  statsStrip: [
    { value: '2', label: 'Hostel Buildings' },
    { value: '4', label: 'Sharing Rooms' },
    { value: '₹8,200+', label: 'Starting Price' },
    { value: '9+', label: 'Amenities' },
    { value: '78+', label: 'Students Staying' },
  ],
  roomInclusions: [
    'Free WiFi',
    'Hot Water',
    'Daily Cleaning',
    '24/7 CCTV',
    'Secure Storage',
    'Warden Security',
    'Washing Machine',
    'Emergency Generator',
    'Attached Washroom',
    '3 Meals Per Day Included',
    'Drinking Water',
  ],
  totalCostClarityText: 'No hidden fees. ₹8,200 covers rent, food, WiFi, electricity, cleaning & security. Everything included.',
  contactFormButtonText: 'Send Enquiry via WhatsApp',
  roomTypeTitle: '4-Sharing Room',
  bedsAvailable: 40,
  intakeMonth: 'July',
  hostelAvailability: {
    bedsAvailable: 40,
    intakeMonth: 'July',
  },
};
