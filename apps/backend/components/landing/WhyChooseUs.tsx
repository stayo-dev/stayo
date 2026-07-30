import { ScrollReveal } from './ScrollReveal';
import type { FeatureContent } from '@lib/sanity/landingContent';
import { getLandingIcon } from './content/icons';
import { urlFor } from '@/sanity/lib/image';

function getFeatureHighlights(title: string) {
  const normalized = title.toLowerCase();
  if (normalized.includes('food') || normalized.includes('meal')) {
    return [
      '3 Hot Meals Daily (Breakfast, Lunch & Dinner)',
      'Sunday Special Meals & festive celebrations',
      'RO Purified drinking water & clean kitchen'
    ];
  }
  if (normalized.includes('safety') || normalized.includes('security') || normalized.includes('warden')) {
    return [
      '24/7 CCTV surveillance across all corridors',
      'Owner & Warden residing on premises',
      'Secure main gate access control'
    ];
  }
  if (normalized.includes('location') || normalized.includes('snist') || normalized.includes('gate')) {
    return [
      'Only 400m from SNIST gate (3 min walk)',
      'Safe well-lit walking path for students',
      'Close to shops, clinics & transport'
    ];
  }
  return [];
}

export function WhyChooseUs({ features = [] }: { features?: FeatureContent[] }) {
  const safeFeatures = features.filter((feature) => feature?.title && feature?.description && feature?.icon);

  if (!safeFeatures.length) return null;

  return (
    <section className="py-10 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Why Choose Us
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.1}>
          <p className="text-center text-[#2C2C2A] mb-12 max-w-2xl mx-auto">
            We provide more than just accommodation — we create a home away from home for students
          </p>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {safeFeatures.map((feature: any, index) => {
            const Icon = getLandingIcon(feature.icon);
            const highlights = feature.highlights && feature.highlights.length > 0
              ? feature.highlights
              : getFeatureHighlights(feature.title);

            let imageUrl = '';
            if (feature.image) {
              if (typeof feature.image === 'string') {
                imageUrl = feature.image;
              } else if (feature.image.url) {
                imageUrl = feature.image.url;
              } else {
                try {
                  imageUrl = urlFor(feature.image).url();
                } catch (e) {
                  imageUrl = '';
                }
              }
            }

            return (
              <ScrollReveal key={feature.title} delay={index * 0.15}>
                <div className="bg-white rounded-xl border border-[#F07B1D]/15 overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 flex flex-col h-full group">
                  <div className="relative h-44 w-full overflow-hidden">
                    <img
                      src={imageUrl}
                      alt={feature.image?.alt || feature.title}
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#1B2D5B]/90 via-[#1B2D5B]/30 to-transparent" />
                    <div className="absolute bottom-4 left-4 flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#F07B1D] rounded-full flex items-center justify-center text-white shadow-md">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-white drop-shadow-sm">{feature.title}</h3>
                    </div>
                  </div>
                  <div className="p-5 flex-1 flex flex-col justify-between bg-[#FFFDF5]/40">
                    <div>
                      <p className="text-[#2C2C2A] text-sm leading-relaxed mb-4">
                        {feature.description}
                      </p>
                      {highlights.length > 0 && (
                        <ul className="space-y-2 border-t border-[#F07B1D]/10 pt-3">
                          {highlights.map((item: string) => (
                            <li key={item} className="flex items-start gap-2 text-xs text-[#2C2C2A]/90 font-medium">
                              <span className="text-[#F07B1D] mt-0.5 font-bold">✓</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
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
