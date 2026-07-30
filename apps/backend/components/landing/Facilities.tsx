import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';
import type { FacilityContent } from '@lib/sanity/landingContent';
import { getLandingIcon } from './content/icons';

export function Facilities({ facilities = [] }: { facilities?: FacilityContent[] }) {
  const safeFacilities = facilities.filter((facility) => facility?.title && facility?.icon);
  if (!safeFacilities.length) return null;

  // Elevate "Meals Included" or "Food" to the first position
  let sortedFacilities = [...safeFacilities];
  const mealIndex = sortedFacilities.findIndex(f =>
    f.title.toLowerCase().includes('meal') ||
    f.title.toLowerCase().includes('food') ||
    f.title.toLowerCase().includes('dining')
  );
  if (mealIndex > -1) {
    const [mealItem] = sortedFacilities.splice(mealIndex, 1);
    sortedFacilities.unshift(mealItem);
  }

  const totalCount = sortedFacilities.length;
  const isOdd = totalCount % 2 !== 0;

  return (
    <section id="facilities" className="py-10 md:py-24 bg-[#FFFDF5]">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Facilities & Amenities
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="text-center text-[#2C2C2A] mb-12 max-w-2xl mx-auto">
            Everything you need for comfortable and secure hostel living
          </p>
        </ScrollReveal>

        <StaggerReveal staggerDelay={0.08}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {sortedFacilities.map((facility, index) => {
              const Icon = getLandingIcon(facility.icon, 'wifi');
              const isLastItem = index === totalCount - 1;

              return (
                <StaggerItem key={index} className={`block ${isLastItem && isOdd ? "col-span-2 md:col-span-1" : ""}`}>
                  <div className="bg-white p-6 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 flex flex-col items-center text-center border border-[#F07B1D]/10 h-full">
                    <div className="w-14 h-14 bg-[#F07B1D]/10 rounded-full flex items-center justify-center mb-4">
                      <Icon className="w-7 h-7 text-[#F07B1D]" />
                    </div>
                    <span className="text-[#1B2D5B] font-semibold text-sm md:text-base">{facility.title}</span>
                    {facility.description && (
                      <p className="mt-2 text-xs leading-5 text-[#2C2C2A]/75">{facility.description}</p>
                    )}
                  </div>
                </StaggerItem>
              );
            })}
          </div>
        </StaggerReveal>
      </div>
    </section>
  );
}
