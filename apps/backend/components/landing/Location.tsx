import { MapPin, Navigation, Star } from 'lucide-react';
import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';

export function Location({
  siteSettings,
  hostel,
}: {
  siteSettings: any;
  hostel: any;
}) {
  const address = siteSettings.address || '';
  const addressLines = address.split('\n').filter(Boolean);
  
  const directionsUrl = siteSettings.googleMapsUrl || '';
  const readReviewsUrl = siteSettings.googleReadReviewsUrl || '';
  const writeReviewUrl = siteSettings.googleWriteReviewUrl || '';
  const embedUrl = hostel.mapEmbedUrl || '';

  const googleRating = siteSettings.googleRating;
  const reviewCount = siteSettings.googleReviewCount;

  const locationTitle = hostel.locationTitle || "Location";
  const locationDescription = hostel.locationDescription || '';
  const distanceTitle = hostel.distanceTitle || '';
  const distanceDescription = hostel.distanceDescription || '';

  return (
    <section id="location" className="py-10 md:py-24 bg-[#FFFDF5]">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {locationTitle}
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="text-center text-[#2C2C2A] mb-12 max-w-2xl mx-auto">
            {locationDescription}
          </p>
        </ScrollReveal>

        <StaggerReveal>
          <div className="grid md:grid-cols-2 gap-8 items-start">
            <StaggerItem>
              <div className="bg-white p-8 rounded-xl shadow-lg space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-[#F07B1D] rounded-full flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-[#1B2D5B] mb-2">Address</h3>
                    <p className="text-[#2C2C2A] font-medium text-sm md:text-base">
                      {addressLines.map((line, idx) => (
                        <span key={idx}>
                          {line}
                          <br />
                        </span>
                      ))}
                    </p>
                  </div>
                </div>

                <div className="bg-[#FBB040]/10 border border-[#FBB040]/30 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <Navigation className="w-6 h-6 text-[#F07B1D]" />
                    <div>
                      <div className="font-bold text-[#1B2D5B]">{distanceTitle}</div>
                      <div className="text-sm text-[#2C2C2A] font-semibold">{distanceDescription}</div>
                    </div>
                  </div>
                </div>

                {/* Google Maps Rating Card */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex flex-col gap-2 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-lg text-green-700">{googleRating.toFixed(1)}</span>
                    <div className="flex gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} className={`w-4 h-4 ${i < Math.round(googleRating) ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
                      ))}
                    </div>
                    <span className="text-xs font-bold text-green-800">Rating on Google</span>
                  </div>
                  <p className="text-xs text-green-800 font-semibold">
                    Over {reviewCount}+ reviews from students and parents.
                  </p>
                  <div className="flex gap-4 mt-1 border-t border-green-200/50 pt-2">
                    <a
                      href={readReviewsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-green-700 hover:underline"
                    >
                      Read Reviews
                    </a>
                    <a
                      href={writeReviewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-bold text-[#F07B1D] hover:underline"
                    >
                      Write a Review
                    </a>
                  </div>
                </div>

                <div className="pt-2">
                  <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full bg-[#1B2D5B] text-white py-3.5 rounded-lg hover:bg-[#152442] transition-colors font-bold shadow-md"
                  >
                    <Navigation className="w-5 h-5" />
                    <span>Get Directions</span>
                  </a>
                </div>
              </div>
            </StaggerItem>

            <StaggerItem>
              <div className="rounded-xl overflow-hidden shadow-lg h-[400px]">
                <iframe
                  src={embedUrl}
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title={`${hostel.name} Location`}
                />
              </div>
            </StaggerItem>
          </div>
        </StaggerReveal>
      </div>
    </section>
  );
}
