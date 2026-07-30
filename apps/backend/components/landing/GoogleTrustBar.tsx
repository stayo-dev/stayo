import { Star } from 'lucide-react';
import { ScrollReveal } from './ScrollReveal';

export function GoogleTrustBar({ siteSettings }: { siteSettings: any }) {
  const rating = siteSettings.googleRating;
  const reviewsCount = siteSettings.googleReviewCount;
  const establishmentYear = siteSettings.establishmentYear || '2019';

  return (
    <section className="bg-[#1B2D5B] border-t border-b border-white/10 py-3 text-white/95">
      <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-6 text-sm font-semibold">
        <ScrollReveal className="flex items-center gap-2">
          <Star className="w-5 h-5 text-[#F07B1D] fill-current" />
          <span>{rating}★ on Google</span>
        </ScrollReveal>
        <span className="hidden sm:inline text-white/30">•</span>
        <ScrollReveal delay={0.1}>
          <span>{reviewsCount} reviews</span>
        </ScrollReveal>
        <span className="hidden sm:inline text-white/30">•</span>
        <ScrollReveal delay={0.2}>
          <span>Since {establishmentYear}</span>
        </ScrollReveal>
      </div>
    </section>
  );
}
