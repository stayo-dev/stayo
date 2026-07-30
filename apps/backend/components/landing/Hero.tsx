'use client';

import { Phone, MessageCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { VideoPlayer } from './VideoPlayer';
import ownerPhoto from './assets/person__up-removebg-preview__1_.png';
import type { LandingAvailability } from './landingTypes';
import { urlFor } from '@/sanity/lib/image';

function rupee(value: number | null | undefined) {
  if (!value) return null;
  return `₹${Number(value).toLocaleString('en-IN')}`;
}

const DEFAULT_HIGHLIGHTS = ['Meals Included', 'CCTV + Warden', '400m from SNIST'];

const DEFAULT_VIDEOS = [
  {
    id: 'room',
    label: 'Room',
    url: 'https://www.w3schools.com/html/mov_bbb.mp4',
    icon: 'bed' as const,
  },
  {
    id: 'common',
    label: 'Common',
    url: 'https://media.w3.org/2010/05/sintel/trailer_hd.mp4',
    icon: 'building' as const,
  },
  {
    id: 'dining',
    label: 'Dining',
    url: 'https://media.w3.org/2010/05/bunny/trailer.mp4',
    icon: 'utensils' as const,
  },
];

export function Hero({
  availability,
  siteSettings,
  hostel,
}: {
  availability?: LandingAvailability;
  siteSettings: any;
  hostel: any;
}) {
  const beds = availability?.bedsAvailable ?? 0;
  const intake = availability?.intakeMonth || 'Current';
  const price = availability?.startingPrice ?? 8000;

  const startingPriceText = rupee(price);
  
  let supportingCopy = hostel?.heroSupportingCopy || (availability?.hasLiveAvailability 
    ? `Join ${availability?.occupiedBeds ?? 0} SNIST students`
    : 'Join senior SNIST students at Sri Adithya Boys Hostel');
  if (startingPriceText) {
    const hasPrice = supportingCopy.includes('₹') || supportingCopy.toLowerCase().includes('/month');
    if (!hasPrice) {
      const cleanCopy = supportingCopy.replace(/[,.]?\s*everything\s+included\.?/gi, '').trim();
      supportingCopy = `${cleanCopy} — ${startingPriceText}/month, everything included.`;
    }
  }

  const primaryHref = availability?.visitUrl || '#contact';
  const whatsappNumber = siteSettings.whatsappNumber;
  const ownerName = siteSettings.ownerName;
  const template = siteSettings.whatsappHeroTemplate || "Hi {ownerName}, I'm interested in checking availability at {hostelName}";
  const message = template
    .replace("{ownerName}", ownerName)
    .replace("{hostelName}", hostel?.name || "");
  const secondaryHref = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  const ownerPhotoUrl = siteSettings.ownerPhoto ? urlFor(siteSettings.ownerPhoto).url() : ownerPhoto.src;

  return (
    <section id="home" className="bg-gradient-to-b from-[#FFFDF5] to-white py-10 md:py-24">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid md:grid-cols-[55%_45%] gap-12 items-center">
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left w-full justify-center sm:justify-start">
              <motion.div
                className="relative flex-shrink-0"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8, ease: [0.25, 0.4, 0.25, 1] }}
              >
                <div className="relative w-24 h-28 md:w-28 md:h-32">
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-24 h-24 md:w-28 md:h-28 rounded-full bg-gradient-to-br from-[#F07B1D]/10 to-[#1B2D5B]/10 border-4 border-white shadow-xl" />
                  <img
                    src={ownerPhotoUrl}
                    alt={`${ownerName} - Owner`}
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 w-24 h-24 md:w-28 md:h-28 rounded-full object-cover border-4 border-white shadow-xl"
                  />
                </div>
              </motion.div>

              <div className="flex flex-col items-center sm:items-start gap-2">
                <motion.div
                  className="inline-flex items-center gap-2 bg-[#1B2D5B] text-white px-4 py-2 rounded-full text-sm border-l-4 border-[#F07B1D] font-medium"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2, ease: [0.25, 0.4, 0.25, 1] }}
                >
                  {siteSettings.ownerQuote || 'I personally respond to every enquiry.'}
                </motion.div>
                <motion.div
                  className="inline-flex items-center gap-2 bg-green-50 text-green-700 border border-green-200 px-4 py-2 rounded-full text-sm font-semibold shadow-sm"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
                >
                  {availability?.hasLiveAvailability ? (
                    <span>🔥 {availability?.occupancyRate || 0}% Occupancy ({availability?.occupiedBeds || 0} Beds Filled)</span>
                  ) : (
                    <span>⭐ Top Rated Student Choice near SNIST Campus</span>
                  )}
                </motion.div>
              </div>
            </div>

            <motion.div
              className="mt-6 text-center sm:text-left"
              initial={{ opacity: 0, y: 36 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.1, ease: [0.25, 0.4, 0.25, 1] }}
            >
              <h1
                className="text-[28px] sm:text-4xl md:text-5xl lg:text-6xl font-bold text-[#1B2D5B] leading-tight mb-6"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {hostel?.heroTitle || (process.env.NODE_ENV === 'development' ? '[CMS Hero Title missing]' : '')}
              </h1>
              <p className="text-lg md:text-2xl text-[#2C2C2A] leading-relaxed">
                {hostel?.heroSubtitle || (process.env.NODE_ENV === 'development' ? '[CMS Hero Subtitle missing]' : '')}
              </p>
            </motion.div>

            {supportingCopy && (
              <motion.p
                className="text-base md:text-lg text-[#2C2C2A]/80 pt-4 text-center sm:text-left"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3, ease: [0.25, 0.4, 0.25, 1] }}
              >
                {supportingCopy}
              </motion.p>
            )}

            <div>
              <motion.div
                className="flex flex-col sm:flex-row gap-4 pt-6"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
              >
                <a
                  href={primaryHref}
                  className="flex items-center justify-center gap-2 bg-[#F07B1D] text-white px-8 py-4 rounded-lg hover:bg-[#d96e18] transition-colors shadow-lg font-semibold w-full sm:w-auto text-center"
                >
                  <Phone className="w-5 h-5" />
                  <span>Book a Room Visit</span>
                </a>
                <a
                  href={secondaryHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-white text-[#1B2D5B] border-l-4 border-green-500 px-8 py-4 rounded-lg hover:shadow-lg transition-all shadow-md font-semibold w-full sm:w-auto text-center"
                >
                  <MessageCircle className="w-5 h-5" />
                  <span>Check Availability on WhatsApp</span>
                </a>
              </motion.div>
              <motion.p
                className="text-sm italic text-red-600 font-semibold mt-3 text-center sm:text-left"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.6 }}
              >
                {availability?.hasLiveAvailability ? (
                  beds > 0 ? (
                    `⚡ Only ${beds} beds available for ${intake} — confirm early`
                  ) : (
                    `🔒 Fully booked for ${intake} — Contact us for waitlist`
                  )
                ) : (
                  `⚡ Admissions open for ${intake} — Contact us to check availability`
                )}
              </motion.p>
            </div>

            <motion.div
              className="flex flex-wrap gap-2.5 pt-8 border-t border-[#F07B1D]/20 mt-8 justify-center sm:justify-start"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7, ease: [0.25, 0.4, 0.25, 1] }}
            >
              {(hostel?.heroHighlights || DEFAULT_HIGHLIGHTS).map((highlight: string) => {
                return (
                  <div
                    key={highlight}
                    className="flex items-center gap-1.5 text-[#2C2C2A] text-xs bg-[#FFFDF5] border border-[#F07B1D]/15 px-3 py-1.5 rounded-full shadow-sm"
                  >
                    <span className="font-semibold">{highlight}</span>
                  </div>
                );
              })}
              {availability?.hasLiveAvailability && beds > 0 ? (
                <div className="flex items-center gap-1.5 text-red-600 font-semibold text-xs bg-red-50 border border-red-100 px-3 py-1.5 rounded-full shadow-sm">
                  <span className="w-1.5 h-1.5 bg-red-600 rounded-full animate-pulse" />
                  <span>{beds} beds left for {intake}</span>
                </div>
              ) : availability?.hasLiveAvailability && beds === 0 ? (
                <div className="flex items-center gap-1.5 text-red-600 font-semibold text-xs bg-red-50 border border-red-100 px-3 py-1.5 rounded-full shadow-sm">
                  <span className="w-1.5 h-1.5 bg-red-600 rounded-full" />
                  <span>Fully Booked</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-blue-600 font-semibold text-xs bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-full shadow-sm">
                  <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" />
                  <span>Admissions Open</span>
                </div>
              )}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
          >
            <VideoPlayer videos={DEFAULT_VIDEOS} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
