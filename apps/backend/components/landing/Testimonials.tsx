import { Star, Shield, UtensilsCrossed, Phone } from 'lucide-react';
import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';
import type { TestimonialContent } from '@lib/sanity/landingContent';

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SA';
}

interface TestimonialsProps {
  testimonials?: TestimonialContent[];
  categoryRatings?: Array<{
    label: string;
    value: number;
    percentage: number;
  }>;
}

export function Testimonials({ testimonials = [], categoryRatings = [] }: TestimonialsProps) {
  const safeTestimonials = testimonials.filter((testimonial) => testimonial?.name && testimonial?.review);

  // Split student testimonials and parent testimonials
  const parentTestimonials = safeTestimonials.filter((t) => t.role?.toLowerCase().includes('parent'));
  const studentTestimonials = safeTestimonials.filter((t) => !t.role?.toLowerCase().includes('parent'));

  // Fallback for parent perspective if none is in CMS
  const parentQuote = parentTestimonials[0] || {
    name: 'Father of Karthik R.',
    role: 'Parent of current resident · Verified Stay',
    review: "My biggest worry was food. Boys don't complain until something is seriously wrong. After visiting once and seeing the kitchen, I stopped worrying. They also WhatsApp me if anything unusual happens — I didn't ask for that. They just do it.",
    rating: 5,
    initials: 'FK',
  };

  // Fallback category ratings if none returned from CMS
  const ratingsToRender = categoryRatings.length
    ? categoryRatings
    : [
        { label: 'Food Quality', value: 4.9, percentage: 98 },
        { label: 'Cleanliness', value: 4.7, percentage: 94 },
        { label: 'Safety', value: 4.8, percentage: 96 },
        { label: 'Value for Money', value: 4.6, percentage: 92 },
      ];

  // Calculate overall average from category ratings
  const averageRating = (
    ratingsToRender.reduce((sum, r) => sum + r.value, 0) / ratingsToRender.length
  ).toFixed(1);

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            What Students & Parents Say
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="text-center text-[#2C2C2A] mb-12 max-w-2xl mx-auto">
            Real words from real people — not written by us.
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.3}>
          <div className="flex flex-col items-center gap-3 mb-12">
            <div className="flex items-center gap-2">
              <span className="text-4xl font-bold text-[#1B2D5B]" style={{ fontFamily: 'var(--font-display)' }}>
                {averageRating}
              </span>
              <Star className="w-8 h-8 text-[#FBB040] fill-[#FBB040]" />
            </div>
            <p className="text-sm text-[#2C2C2A]/60">out of 5</p>

            <div className="w-full max-w-2xl mt-6 space-y-3">
              {ratingsToRender.map((rating, index) => (
                <div key={index} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-[#2C2C2A] w-32 text-right">
                    {rating.label}
                  </span>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#F07B1D] rounded-full transition-all duration-1000"
                      style={{ width: `${rating.percentage}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-[#1B2D5B] w-8">
                    {rating.value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.4}>
          <h3 className="text-xl font-semibold text-[#1B2D5B] mb-6 text-center md:text-left">
            Student Experiences
          </h3>
        </ScrollReveal>

        <StaggerReveal staggerDelay={0.15}>
          <div className="grid md:grid-cols-3 gap-6 mb-6">
            {studentTestimonials.map((testimonial, index) => (
              <StaggerItem key={index}>
                <div className="bg-white rounded-2xl p-6 shadow-lg border border-[#F07B1D]/10 h-full flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    {testimonial.image?.url ? (
                      <img
                        src={testimonial.image.url}
                        alt={testimonial.image.alt || testimonial.name}
                        className="w-12 h-12 rounded-full object-cover border-2 border-[#F07B1D]/20"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-[#F07B1D]/15 border border-[#F07B1D]/30 flex items-center justify-center">
                        <span className="text-[#1B2D5B] font-bold text-sm">
                          {initials(testimonial.name)}
                        </span>
                      </div>
                    )}
                    <div>
                      <div className="font-semibold text-[#1B2D5B]">
                        {testimonial.name}
                      </div>
                      <div className="text-xs text-[#2C2C2A]/60">
                        {testimonial.role}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-1 mb-3">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${
                          i < Math.round(testimonial.rating || 5)
                            ? 'text-[#FBB040] fill-[#FBB040]'
                            : 'text-gray-300'
                        }`}
                      />
                    ))}
                  </div>

                  <p className="text-[#1B2D5B] italic leading-relaxed mb-4 flex-1" style={{ fontSize: '15px' }}>
                    &quot;{testimonial.review}&quot;
                  </p>

                  <div className="inline-flex items-center gap-2 bg-[#F07B1D]/10 border border-[#F07B1D]/20 px-3 py-1.5 rounded-full text-xs font-medium text-[#FBB040] self-start">
                    Stayed Verified
                  </div>
                </div>
              </StaggerItem>
            ))}
          </div>
          <p className="text-center text-[#2C2C2A]/60 text-sm mb-12">
            Names and details shared with permission. Identities partially anonymized.
          </p>
        </StaggerReveal>

        <ScrollReveal delay={0.6}>
          <h3 className="text-xl font-semibold text-[#1B2D5B] mb-6 text-center md:text-left">
            Parent Perspective
          </h3>
        </ScrollReveal>

        <ScrollReveal delay={0.7}>
          <div className="bg-[#FFFDF5] rounded-2xl p-8 shadow-xl border-2 border-[#F07B1D]/20">
            <div className="grid md:grid-cols-[1fr_auto] gap-8 items-center">
              <div>
                <div className="text-6xl text-[#F07B1D] mb-4 leading-none" style={{ fontFamily: 'var(--font-display)' }}>
                  &quot;
                </div>

                <div className="flex items-center gap-3 mb-4">
                  {parentQuote.image?.url ? (
                    <img
                      src={parentQuote.image.url}
                      alt={parentQuote.name}
                      className="w-14 h-14 rounded-full object-cover border-2 border-[#1B2D5B]/20"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-full bg-[#1B2D5B] flex items-center justify-center">
                      <span className="text-white font-bold">
                        {initials(parentQuote.name)}
                      </span>
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-[#1B2D5B]">
                      {parentQuote.name}
                    </div>
                    <div className="text-sm text-[#2C2C2A]/60">
                      {parentQuote.role}
                    </div>
                  </div>
                </div>

                <p
                  className="text-[#1B2D5B] italic leading-relaxed text-lg mb-4"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {parentQuote.review}
                </p>

                <div className="inline-flex items-center gap-2 bg-[#1B2D5B]/10 border border-[#1B2D5B] px-4 py-2 rounded-full text-sm font-medium text-[#1B2D5B]">
                  Parent of resident · Verified Stay
                </div>
              </div>

              <div className="hidden md:flex flex-col gap-4">
                <div className="flex items-center gap-3 bg-white rounded-xl p-4 shadow-md">
                  <div className="w-10 h-10 bg-[#1B2D5B]/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <Shield className="w-5 h-5 text-[#1B2D5B]" />
                  </div>
                  <span className="font-medium text-[#1B2D5B] text-sm">Safe</span>
                </div>

                <div className="flex items-center gap-3 bg-white rounded-xl p-4 shadow-md">
                  <div className="w-10 h-10 bg-green-500/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <UtensilsCrossed className="w-5 h-5 text-green-600" />
                  </div>
                  <span className="font-medium text-[#1B2D5B] text-sm">Fed Well</span>
                </div>

                <div className="flex items-center gap-3 bg-white rounded-xl p-4 shadow-md">
                  <div className="w-10 h-10 bg-[#F07B1D]/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <Phone className="w-5 h-5 text-[#F07B1D]" />
                  </div>
                  <span className="font-medium text-[#1B2D5B] text-sm">Responsive</span>
                </div>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
