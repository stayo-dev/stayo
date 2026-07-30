import { client, getClient } from '@/sanity/lib/client';
import { urlForImage } from '@/sanity/lib/image';
import { fallbackLandingContent, type LandingMarketingContent } from './landingContent';

const combinedQuery = `{
  "siteSettings": *[_type == "siteSettings"][0] {
    title,
    phone,
    whatsappNumber,
    email,
    addressLines,
    googleMapsUrl,
    googleMapsEmbedUrl,
    logo,
    trustBadge,
    seoDescription,
    ogImage
  },
  "hostel": *[_type == "landingHostel"][0] {
    name,
    "description": heroSubtitle,
    "carouselImages": gallery,
    tourVideos[] {
      id,
      label,
      videoUrl,
      "videoFileUrl": videoFile.asset->url,
      icon
    },
    features[] {
      title,
      description,
      icon,
      image
    },
    facilities[] {
      title,
      icon,
      description
    },
    admissionSteps[] {
      step,
      stepNumber,
      title,
      description
    }
  },
  "testimonials": *[_type == "testimonial"] | order(displayOrder asc) {
    name,
    details,
    quote,
    rating,
    initials,
    duration,
    image
  },
  "faqs": *[_type == "faq"] | order(displayOrder asc) {
    question,
    answer
  },
  "categoryRatings": *[_type == "categoryRating"] | order(displayOrder asc) {
    label,
    value,
    percentage
  }
}`;

export async function getLandingMarketingContent(previewToken?: string): Promise<LandingMarketingContent & { categoryRatings?: any[] }> {
  try {
    const activeClient = previewToken ? getClient(previewToken) : client;
    const data = await activeClient.fetch(combinedQuery);

    if (!data) return fallbackLandingContent;

    const settings = data.siteSettings || {};
    const hostel = data.hostel || {};
    const testimonials = data.testimonials || [];
    const faqs = data.faqs || [];
    const categoryRatings = data.categoryRatings || [];

    // Construct the mapped content structure
    return {
      hostelProfile: {
        name: hostel.name || fallbackLandingContent.hostelProfile.name,
        phone: settings.phone || fallbackLandingContent.hostelProfile.phone,
        whatsappNumber: settings.whatsappNumber || fallbackLandingContent.hostelProfile.whatsappNumber,
        email: settings.email || fallbackLandingContent.hostelProfile.email,
        shortLocation: hostel.shortLocation || fallbackLandingContent.hostelProfile.shortLocation,
        addressLines: settings.addressLines || fallbackLandingContent.hostelProfile.addressLines,
        locationTitle: hostel.locationTitle || fallbackLandingContent.hostelProfile.locationTitle,
        locationDescription: hostel.locationDescription || fallbackLandingContent.hostelProfile.locationDescription,
        distanceTitle: hostel.distanceTitle || fallbackLandingContent.hostelProfile.distanceTitle,
        distanceDescription: hostel.distanceDescription || fallbackLandingContent.hostelProfile.distanceDescription,
        googleMapsUrl: settings.googleMapsUrl || fallbackLandingContent.hostelProfile.googleMapsUrl,
        googleMapsEmbedUrl: settings.googleMapsEmbedUrl || fallbackLandingContent.hostelProfile.googleMapsEmbedUrl,
        ownerName: hostel.ownerName || fallbackLandingContent.hostelProfile.ownerName,
        ownerMessage: hostel.ownerMessage || fallbackLandingContent.hostelProfile.ownerMessage,
        ownerPhoto: hostel.ownerPhoto
          ? { url: urlForImage(hostel.ownerPhoto).url(), alt: hostel.ownerName || 'OwnerPhoto' }
          : fallbackLandingContent.hostelProfile.ownerPhoto,
      },
      seo: {
        title: settings.title
          ? `Best Boys Hostel in Yamnampet, Secunderabad | ${settings.title}`
          : fallbackLandingContent.seo.title,
        description: settings.seoDescription || fallbackLandingContent.seo.description,
        canonicalUrl: fallbackLandingContent.seo.canonicalUrl,
        ogImage: settings.ogImage
          ? { url: urlForImage(settings.ogImage).url(), alt: settings.title || 'SEO Image' }
          : fallbackLandingContent.seo.ogImage,
      },
      hero: {
        title: hostel.name ? `Feel at Home, Every Day at ${hostel.name}` : fallbackLandingContent.hero.title,
        subtitle: hostel.description || fallbackLandingContent.hero.subtitle,
        supportingCopy: hostel.startingPrice
          ? `Join 78+ SNIST students, starting from ₹${Number(hostel.startingPrice).toLocaleString('en-IN')}/mo.`
          : fallbackLandingContent.hero.supportingCopy,
        trustBadge: settings.trustBadge || fallbackLandingContent.hero.trustBadge,
        highlights: hostel.features
          ? hostel.features.slice(0, 3).map((f: any) => f.title)
          : fallbackLandingContent.hero.highlights,
        primaryCta: fallbackLandingContent.hero.primaryCta,
        secondaryCta: settings.whatsappNumber
          ? { label: 'Check Availability on WhatsApp', href: `https://api.whatsapp.com/send?phone=${settings.whatsappNumber}` }
          : fallbackLandingContent.hero.secondaryCta,
        ownerImage: hostel.ownerPhoto
          ? { url: urlForImage(hostel.ownerPhoto).url(), alt: hostel.ownerName || 'OwnerImage' }
          : fallbackLandingContent.hero.ownerImage,
        carouselImages: hostel.carouselImages && hostel.carouselImages.length
          ? hostel.carouselImages.map((img: any) => ({
              url: urlForImage(img).url(),
              alt: img.alt || 'Carousel Image',
              caption: img.caption,
            }))
          : fallbackLandingContent.hero.carouselImages,
        tourVideos: hostel.tourVideos && hostel.tourVideos.length
          ? hostel.tourVideos.map((v: any) => ({
              id: v.id,
              label: v.label,
              url: v.videoFileUrl || v.videoUrl,
              icon: v.icon,
            }))
          : fallbackLandingContent.hero.tourVideos,
      },
      announcements: [],
      features: hostel.features && hostel.features.length
        ? hostel.features.map((f: any) => ({
            title: f.title,
            description: f.description,
            icon: f.icon,
            image: f.image ? { url: urlForImage(f.image).url(), alt: f.title } : undefined,
          }))
        : fallbackLandingContent.features,
      facilities: hostel.facilities && hostel.facilities.length
        ? hostel.facilities.map((fac: any) => ({
            title: fac.title,
            icon: fac.icon,
            description: fac.description,
          }))
        : fallbackLandingContent.facilities,
      testimonials: testimonials.length
        ? testimonials.map((t: any) => ({
            name: t.name,
            role: t.details || t.duration,
            review: t.quote,
            rating: t.rating || 5,
            image: t.image ? { url: urlForImage(t.image).url(), alt: t.name } : undefined,
          }))
        : fallbackLandingContent.testimonials,
      faqs: faqs.length
        ? faqs.map((f: any) => ({
            question: f.question,
            answer: f.answer,
          }))
        : fallbackLandingContent.faqs,
      gallery: hostel.carouselImages && hostel.carouselImages.length
        ? hostel.carouselImages.map((img: any) => ({
            url: urlForImage(img).url(),
            alt: img.alt || 'Gallery Image',
            caption: img.caption,
          }))
        : fallbackLandingContent.gallery,
      admissionSteps: hostel.admissionSteps && hostel.admissionSteps.length
        ? hostel.admissionSteps.map((step: any) => {
            const stepVal = step.step || step.stepNumber;
            return {
              step: stepVal,
              stepNumber: stepVal,
              title: step.title,
              description: step.description,
            };
          })
        : fallbackLandingContent.admissionSteps,
      footer: {
        title: settings.title || fallbackLandingContent.footer.title,
        description: fallbackLandingContent.footer.description,
        quickLinks: fallbackLandingContent.footer.quickLinks,
        copyright: `© ${new Date().getFullYear()} ${settings.title || fallbackLandingContent.footer.title}. All rights reserved.`,
      },
      categoryRatings: categoryRatings.length
        ? categoryRatings
        : [
            { label: 'Food Quality', value: 4.9, percentage: 98 },
            { label: 'Cleanliness', value: 4.7, percentage: 94 },
            { label: 'Safety', value: 4.8, percentage: 96 },
            { label: 'Value for Money', value: 4.6, percentage: 92 },
          ],
    };
  } catch (error) {
    console.error('Error fetching Sanity landing content:', error);
    return fallbackLandingContent;
  }
}

export { fallbackLandingContent };
export type { LandingMarketingContent };
