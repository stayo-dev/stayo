import { Check, MessageCircle } from 'lucide-react';
import { ScrollReveal } from './ScrollReveal';
import type { LandingAvailability } from './landingTypes';
import type { FacilityContent } from '@lib/sanity/landingContent';
import { urlFor } from '@/sanity/lib/image';

export function RoomPricing({
  availability,
  facilities,
  siteSettings,
  hostel,
}: {
  availability?: LandingAvailability;
  facilities?: FacilityContent[];
  siteSettings?: any;
  hostel?: any;
}) {
  const included = facilities?.filter((facility) => facility?.title).slice(0, 8).map((facility) => facility.title) || [];
  const whatsappNumber = siteSettings?.whatsappNumber;
  const template = siteSettings?.whatsappRoomBookingTemplate || "Hi, I'm interested in checking availability for {sharingType} at {hostelName}";
  const roomTypes = availability?.roomTypes || [];

  return (
    <section id="rooms" className="py-10 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Rooms & Pricing
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="text-center text-[#2C2C2A] mb-12 max-w-2xl mx-auto">
            Affordable accommodation with all amenities included
          </p>
        </ScrollReveal>

        <div className={`grid gap-8 justify-center mx-auto ${
          roomTypes.length === 1 
            ? 'max-w-xl grid-cols-1' 
            : roomTypes.length === 2 
            ? 'max-w-4xl grid-cols-1 md:grid-cols-2' 
            : 'max-w-6xl grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
        }`}>
          {roomTypes.map((room, idx) => {
            const cleanPrice = (room.roomType.includes('4-Sharing') || roomTypes.length === 1) && typeof hostel?.startingPrice === 'number'
              ? hostel.startingPrice 
              : room.baseRent;
            const formattedPrice = `₹${Number(cleanPrice).toLocaleString('en-IN')}`;
            const whatsappMessage = template
              .replace("{sharingType}", room.roomType)
              .replace("{hostelName}", hostel?.name || "");
            const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(whatsappMessage)}`;
            
            // Choose image: prioritize image from Sanity CMS roomTypesImages mapping, fall back to hostel.roomImage or default
            const cmsImage = hostel?.roomTypesImages?.find(
              (item: any) => item.roomType === room.roomType
            )?.image;
            let roomImage = '/SAH_Room.webp';
            if (cmsImage) {
              roomImage = urlFor(cmsImage).url();
            } else if (hostel?.roomImage) {
              roomImage = urlFor(hostel.roomImage).url();
            }

            const hasVacancy = room.availableBeds > 0;

            return (
              <ScrollReveal key={room.roomType} delay={0.3 + idx * 0.1}>
                <div className="bg-[#FFFDF5] rounded-2xl shadow-xl overflow-hidden border-2 border-[#F07B1D] relative h-full flex flex-col justify-between">
                  <div>
                    {availability?.hasLiveAvailability && (
                      <div className={`absolute top-0 left-0 right-0 text-white text-center py-2 text-sm font-medium z-10 ${hasVacancy ? 'bg-[#F07B1D]' : 'bg-red-600'}`}>
                        {hasVacancy 
                          ? `Only ${room.availableBeds} beds available this month` 
                          : 'Sold Out / No Vacancy'}
                      </div>
                    )}
                    <div className={`aspect-[16/9] relative overflow-hidden ${availability?.hasLiveAvailability ? 'mt-10' : ''}`}>
                      <img
                        src={roomImage}
                        alt={room.roomType}
                        className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                    </div>

                    <div className="p-6 md:p-8">
                      <div className="flex items-center justify-between mb-6 gap-2">
                        <h3 className="text-xl md:text-2xl font-bold text-[#1B2D5B]">{room.roomType}</h3>
                        <div className="text-right">
                          <div
                            className="text-3xl font-extrabold text-[#F07B1D]"
                            style={{ fontFamily: 'var(--font-display)' }}
                          >
                            {formattedPrice}
                          </div>
                          <div className="text-xs font-semibold text-[#2C2C2A]/70 mt-1">
                            Rent starts at {formattedPrice}/mo
                          </div>
                        </div>
                      </div>

                      <div className="mb-6">
                        {included.length > 0 && (
                          <>
                            <h4 className="font-semibold text-[#1B2D5B] mb-3 text-sm">What's Included:</h4>
                            <div className="grid grid-cols-2 gap-2 mb-4">
                              {included.slice(0, 6).map((item, index) => (
                                <div key={index} className="flex items-start gap-1.5">
                                  <Check className="w-4 h-4 text-[#F07B1D] flex-shrink-0 mt-0.5" />
                                  <span className="text-[#2C2C2A] text-xs font-medium">{item}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                        <div className="bg-[#FFFDF5] border border-[#F07B1D]/20 rounded-lg p-3 mt-3">
                          <h5 className="font-semibold text-[#1B2D5B] text-xs mb-1">Live Pricing & Inventory</h5>
                          <p className="text-[#2C2C2A]/85 text-xs">
                            No hidden fees. Rent is confirmed from live HMS database pricing. <strong className="text-[#F07B1D]">{formattedPrice}</strong> is the current price.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-6 md:p-8 pt-0 mt-auto">
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2 w-full text-white py-3.5 rounded-lg transition-colors font-semibold shadow-lg ${
                        hasVacancy 
                          ? 'bg-[#F07B1D] hover:bg-[#d96e18]' 
                          : 'bg-[#1B2D5B] hover:bg-[#152347]'
                      }`}
                    >
                      <MessageCircle className="w-5 h-5" />
                      <span>{hasVacancy ? 'WhatsApp to Book' : 'WhatsApp for Waitlist'}</span>
                    </a>
                    <p className="text-xs text-[#2C2C2A]/60 italic text-center mt-2.5 font-medium">
                      {availability?.hasLiveAvailability 
                        ? (hasVacancy 
                          ? 'Availability updates from live admissions data' 
                          : 'Hostel is full. Chat to join waitlist.')
                        : 'Contact us to check current availability'}
                    </p>
                  </div>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
