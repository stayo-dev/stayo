import { fallbackLandingContent, type LandingMarketingContent } from './landingContent';

const projectId = String(import.meta.env.VITE_SANITY_PROJECT_ID || '8hc770qr').trim();
const dataset = String(import.meta.env.VITE_SANITY_DATASET || 'production').trim();
const apiVersion = String(import.meta.env.VITE_SANITY_API_VERSION || '2026-06-01').trim();

const landingQuery = `{
  "landingHostel": *[_type == "landingHostel"][0]{
    name,
    announcementBarEnabled,
    announcementBarText,
    announcementBarLinkText,
    heroTitle,
    heroSubtitle,
    heroSupportingCopy,
    heroHighlights,
    heroTrustedBadgeText,
    heroPrimaryCtaText,
    heroSecondaryCtaText,
    statsStrip[] {
      value,
      label
    },
    gallery[] {
      "url": image.asset->url,
      caption,
      alt
    },
    mapEmbedUrl,
    totalBuildings,
    sharingTypes,
    amenitiesCount,
    roomTypeTitle,
    "roomImage": roomImage { "url": asset->url, alt },
    startingPrice,
    bedsAvailable,
    intakeMonth,
    locationTitle,
    locationDescription,
    distanceTitle,
    distanceDescription,
    shortLocation,
    features[] {
      title,
      description,
      icon,
      "image": image { "url": asset->url, alt },
      highlights,
      bulletPoints
    },
    facilities[] {
      title,
      icon,
      description
    },
    roomInclusions,
    totalCostClarityText,
    contactFormButtonText,
    admissionSteps[] {
      step,
      title,
      description,
      icon
    },
    roomTypesImages[] {
      roomType,
      "image": image { "url": asset->url, alt }
    },
    tourVideos[] {
      id,
      label,
      videoUrl,
      "videoFileUrl": videoFile.asset->url,
      icon
    }
  },
  "siteSettings": *[_type == "siteSettings"][0]{
    phoneNumber,
    whatsappNumber,
    email,
    ownerName,
    ownerQuote,
    "ownerPhoto": ownerPhoto { "url": asset->url, alt },
    announcements[] {
      title,
      description,
      cta,
      startDate,
      endDate,
      priority,
      isActive
    },
    ogTitle,
    ogDescription,
    googleMapsUrl,
    whatsappEnquiryTemplate,
    whatsappFABTemplate
  },
  "testimonials": *[_type == "testimonial" && isActive != false] | order(order asc) {
    name,
    type,
    "role": coalesce(role, type),
    "review": coalesce(quote, review),
    rating,
    "image": coalesce(image { "url": asset->url, alt }, photo { "url": asset->url, alt })
  },
  "faqs": *[_type == "faq" && isActive != false] | order(order asc) {
    question,
    answer
  }
}`;

function hasImage(image: any) {
  return Boolean(image?.url);
}

function hasText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function compactFeatures(features: any[] | undefined) {
  return (Array.isArray(features) ? features : [])
    .filter(
      (feature) => feature && hasText(feature.title) && hasText(feature.description) && hasText(feature.icon),
    )
    .map((feature) => ({
      ...feature,
      bulletPoints: Array.isArray(feature.bulletPoints) ? feature.bulletPoints : [],
    }));
}

function compactFacilities(facilities: any[] | undefined) {
  return (Array.isArray(facilities) ? facilities : []).filter(
    (facility) => facility && hasText(facility.title) && hasText(facility.icon),
  );
}

function compactTestimonials(testimonials: any[] | undefined) {
  return (Array.isArray(testimonials) ? testimonials : [])
    .filter((testimonial) => testimonial && hasText(testimonial.name) && hasText(testimonial.review))
    .map((testimonial) => ({
      ...testimonial,
      rating: Number(testimonial.rating || 5),
      image: hasImage(testimonial.image) ? testimonial.image : undefined,
    }));
}

function compactFaqs(faqs: any[] | undefined) {
  return (Array.isArray(faqs) ? faqs : []).filter(
    (faq) => faq && hasText(faq.question) && hasText(faq.answer),
  );
}

function compactStats(stats: any[] | undefined) {
  return (Array.isArray(stats) ? stats : []).filter(
    (stat) => stat && hasText(stat.value) && hasText(stat.label)
  );
}

function compactAdmissionSteps(steps: any[] | undefined) {
  return (Array.isArray(steps) ? steps : [])
    .filter((step) => step && Number.isFinite(Number(step.step ?? step.stepNumber)) && hasText(step.title) && hasText(step.description))
    .map((step) => {
      const stepVal = Number(step.step ?? step.stepNumber);
      return { 
        ...step, 
        step: stepVal,
        stepNumber: stepVal,
        icon: step.icon 
      };
    });
}

function activeAnnouncements(announcements: any[] | undefined) {
  const now = Date.now();
  return (Array.isArray(announcements) ? announcements : []).filter((item) => {
    const startsOk = !item?.startDate || new Date(item.startDate).getTime() <= now;
    const endsOk = !item?.endDate || new Date(item.endDate).getTime() >= now;
    return item?.title && startsOk && endsOk && item.isActive !== false;
  });
}

function mergeLandingContent(result: any): LandingMarketingContent {
  const h = result?.landingHostel;
  const s = result?.siteSettings;
  const t = result?.testimonials || [];
  const f = result?.faqs || [];

  return {
    hostelProfile: {
      name: h?.name || fallbackLandingContent.hostelProfile.name,
      phone: s?.phoneNumber || fallbackLandingContent.hostelProfile.phone,
      whatsappNumber: s?.whatsappNumber
        ? (s.whatsappNumber.startsWith('91') ? s.whatsappNumber : '91' + s.whatsappNumber.replace(/\D/g, ''))
        : fallbackLandingContent.hostelProfile.whatsappNumber,
      email: s?.email || fallbackLandingContent.hostelProfile.email,
      shortLocation: h?.shortLocation || fallbackLandingContent.hostelProfile.shortLocation,
      addressLines: h?.shortLocation ? [h.name, h.shortLocation] : fallbackLandingContent.hostelProfile.addressLines,
      locationTitle: h?.locationTitle || fallbackLandingContent.hostelProfile.locationTitle,
      locationDescription: h?.locationDescription || fallbackLandingContent.hostelProfile.locationDescription,
      distanceTitle: h?.distanceTitle || fallbackLandingContent.hostelProfile.distanceTitle,
      distanceDescription: h?.distanceDescription || fallbackLandingContent.hostelProfile.distanceDescription,
      googleMapsUrl: s?.googleMapsUrl || fallbackLandingContent.hostelProfile.googleMapsUrl,
      googleMapsEmbedUrl: h?.mapEmbedUrl || fallbackLandingContent.hostelProfile.googleMapsEmbedUrl,
      ownerName: s?.ownerName || fallbackLandingContent.hostelProfile.ownerName,
      ownerMessage: s?.ownerQuote || fallbackLandingContent.hostelProfile.ownerMessage,
      ownerPhoto: hasImage(s?.ownerPhoto) ? s.ownerPhoto : fallbackLandingContent.hostelProfile.ownerPhoto,
    },
    seo: {
      title: s?.ogTitle || fallbackLandingContent.seo.title,
      description: s?.ogDescription || fallbackLandingContent.seo.description,
      canonicalUrl: fallbackLandingContent.seo.canonicalUrl,
    },
    hero: {
      title: h?.heroTitle || (import.meta.env.DEV ? '[CMS Hero Title missing]' : fallbackLandingContent.hero.title),
      subtitle: h?.heroSubtitle || (import.meta.env.DEV ? '[CMS Hero Subtitle missing]' : fallbackLandingContent.hero.subtitle),
      supportingCopy: h?.heroSupportingCopy || fallbackLandingContent.hero.supportingCopy,
      trustBadge: h?.heroTrustedBadgeText || fallbackLandingContent.hero.trustBadge,
      primaryCtaText: h?.heroPrimaryCtaText,
      secondaryCtaText: h?.heroSecondaryCtaText,
      highlights: h?.heroHighlights || fallbackLandingContent.hero.highlights,
      ownerImage: hasImage(s?.ownerPhoto) ? s.ownerPhoto : undefined,
      carouselImages: h?.gallery && h.gallery.length > 0 ? h.gallery : fallbackLandingContent.hero.carouselImages,
      tourVideos: h?.tourVideos && h.tourVideos.length > 0
        ? h.tourVideos.map((v: any) => ({
            id: v.id,
            label: v.label,
            url: v.videoFileUrl || v.videoUrl || '',
            icon: v.icon,
          }))
        : fallbackLandingContent.hero.tourVideos,
    },
    announcements: activeAnnouncements(s?.announcements),
    features: compactFeatures(h?.features || fallbackLandingContent.features),
    facilities: compactFacilities(h?.facilities || fallbackLandingContent.facilities),
    testimonials: compactTestimonials(t.length ? t : fallbackLandingContent.testimonials),
    faqs: compactFaqs(f.length ? f : fallbackLandingContent.faqs),
    gallery: h?.gallery && h.gallery.length > 0 ? h.gallery : fallbackLandingContent.gallery,
    admissionSteps: compactAdmissionSteps(h?.admissionSteps || fallbackLandingContent.admissionSteps),
    footer: {
      title: h?.name || fallbackLandingContent.footer.title,
      description: fallbackLandingContent.footer.description,
      quickLinks: fallbackLandingContent.footer.quickLinks,
      copyright: `© ${new Date().getFullYear()} ${h?.name || fallbackLandingContent.footer.title}. All rights reserved.`,
    },
    announcementBarEnabled: h?.announcementBarEnabled,
    announcementBarText: h?.announcementBarText,
    announcementBarLinkText: h?.announcementBarLinkText,
    statsStrip: compactStats(h?.statsStrip),
    roomInclusions: h?.roomInclusions,
    totalCostClarityText: h?.totalCostClarityText,
    contactFormButtonText: h?.contactFormButtonText,
    roomTypeTitle: h?.roomTypeTitle,
    roomImage: hasImage(h?.roomImage) ? h.roomImage : undefined,
    startingPrice: typeof h?.startingPrice === 'number' ? h.startingPrice : undefined,
    hostelAvailability: {
      bedsAvailable: typeof h?.bedsAvailable === 'number' ? h.bedsAvailable : null,
      intakeMonth: h?.intakeMonth || null,
    },
  };
}

export async function getLandingMarketingContent(): Promise<LandingMarketingContent> {
  if (!projectId || !dataset) return fallbackLandingContent;

  const url = new URL(`https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}`);
  url.searchParams.set('query', landingQuery);

  const response = await fetch(url.toString(), { credentials: 'omit' });
  if (!response.ok) throw new Error(`Sanity content request failed: ${response.status}`);

  const payload = await response.json();
  if (!payload?.result) return fallbackLandingContent;
  return mergeLandingContent(payload.result);
}

export { fallbackLandingContent };
export type { LandingMarketingContent };
