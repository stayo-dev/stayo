import { Metadata } from "next";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { TopBar } from "@/components/landing/TopBar";
import { Navbar } from "@/components/landing/Navbar";
import { GoogleTrustBar } from "@/components/landing/GoogleTrustBar";
import { AnnouncementBanner } from "@/components/landing/AnnouncementBanner";
import { Hero } from "@/components/landing/Hero";
import { StatsStrip } from "@/components/landing/StatsStrip";
import { WhyChooseUs } from "@/components/landing/WhyChooseUs";
import { FoodSection } from "@/components/landing/FoodSection";
import { ParentTrust } from "@/components/landing/ParentTrust";
import { Facilities } from "@/components/landing/Facilities";
import { GallerySection } from "@/components/landing/GallerySection";
import { Testimonials } from "@/components/landing/Testimonials";
import { AdmissionProcess } from "@/components/landing/AdmissionProcess";
import { RoomPricing } from "@/components/landing/RoomPricing";
import { Location } from "@/components/landing/Location";
import { FaqSection } from "@/components/landing/FaqSection";
import { EnquiryForm } from "@/components/landing/EnquiryForm";
import { Footer } from "@/components/landing/Footer";
import { WhatsAppFAB } from "@/components/landing/WhatsAppFAB";
import type { LandingAvailability } from "@/components/landing/landingTypes";
import { client } from "@/sanity/lib/client";
import {
  SITE_SETTINGS_QUERY,
  LANDING_HOSTEL_QUERY,
  TESTIMONIALS_QUERY,
  FAQS_QUERY,
  CATEGORY_RATINGS_QUERY,
} from "@/sanity/lib/queries";
import { urlFor } from "@/sanity/lib/image";
import { fallbackLandingContent, fallbackSiteSettings } from "@/lib/sanity/landingContent";

export const revalidate = 3600; // Cache page for up to 1 hour, revalidated via webhooks

const PRIMARY_VISIT_SLUG = process.env.NEXT_PUBLIC_PRIMARY_VISIT_SLUG || "sah-1-ea89eed3";

function currentIntakeMonth() {
  return new Intl.DateTimeFormat("en-IN", { month: "long" }).format(new Date());
}

async function getAvailability(slug: string): Promise<LandingAvailability> {
  try {
    const data = await admissionsService.getPublicHostel(slug);
    const rooms = Array.isArray(data?.rooms) ? data.rooms : [];
    
    const bedsAvailable = rooms.reduce((sum: number, room: any) => sum + Number(room.available_beds || 0), 0);
    const totalBeds = rooms.reduce((sum: number, room: any) => sum + Number(room.capacity || 0), 0);
    const occupiedBeds = rooms.reduce((sum: number, room: any) => sum + Number(room.occupied_count || 0), 0);
    const reservedBeds = rooms.reduce((sum: number, room: any) => sum + Number(room.reserved_count || 0), 0);

    const roomTypeMap = new Map<string, {
      roomType: string;
      capacity: number;
      rents: number[];
      availableBeds: number;
      occupiedCount: number;
      totalRoomsCount: number;
      photos: string[];
    }>();

    for (const room of rooms) {
      let typeName = room.room_type || "Standard";
      if (typeName === "Standard" && room.capacity) {
        typeName = `${room.capacity}-Sharing`;
      }
      const rent = Number(room.pricing?.monthly_rent || 0);

      if (!roomTypeMap.has(typeName)) {
        roomTypeMap.set(typeName, {
          roomType: typeName,
          capacity: room.capacity || 0,
          rents: [],
          availableBeds: 0,
          occupiedCount: 0,
          totalRoomsCount: 0,
          photos: [],
        });
      }

      const entry = roomTypeMap.get(typeName)!;
      if (rent > 0) entry.rents.push(rent);
      entry.availableBeds += Number(room.available_beds || 0);
      entry.occupiedCount += Number(room.occupied_count || 0);
      entry.totalRoomsCount += 1;
      if (Array.isArray(room.photos)) {
        for (const p of room.photos) {
          if (p && !entry.photos.includes(p)) {
            entry.photos.push(p);
          }
        }
      }
    }

    const roomTypesList = Array.from(roomTypeMap.values()).map((entry) => {
      const minRent = entry.rents.length > 0 ? Math.min(...entry.rents) : 0;
      return {
        roomType: entry.roomType,
        capacity: entry.capacity,
        baseRent: minRent || data?.hostel?.starting_price || 8000,
        availableBeds: entry.availableBeds,
        occupiedCount: entry.occupiedCount,
        totalRoomsCount: entry.totalRoomsCount,
        photos: entry.photos,
      };
    });

    const roomPrices = rooms
      .map((room: any) => Number(room.pricing?.monthly_rent || 0))
      .filter(Boolean)
      .sort((a: number, b: number) => a - b);
    const startingPrice = roomPrices[0] || data?.hostel?.starting_price || 8000;

    const sharingTypesList = Array.from(new Set(roomTypesList.map((r) => r.roomType)));
    const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

    return {
      bedsAvailable,
      totalBeds,
      occupiedBeds,
      reservedBeds,
      occupancyRate,
      startingPrice,
      sharingTypes: sharingTypesList,
      roomTypes: roomTypesList,
      intakeMonth: currentIntakeMonth(),
      visitUrl: slug ? `/visit/${slug}` : "",
      hasLiveAvailability: true,
    };
  } catch (error) {
    console.error("Failed to fetch public hostel availability:", error);
    return {
      bedsAvailable: 0,
      totalBeds: 0,
      occupiedBeds: 0,
      reservedBeds: 0,
      occupancyRate: 0,
      startingPrice: 8000,
      sharingTypes: ["2-Sharing", "3-Sharing", "4-Sharing"],
      roomTypes: [
        {
          roomType: "2-Sharing",
          capacity: 2,
          baseRent: 9500,
          availableBeds: 0,
          occupiedCount: 0,
          totalRoomsCount: 0,
          photos: [],
        },
        {
          roomType: "3-Sharing",
          capacity: 3,
          baseRent: 8500,
          availableBeds: 0,
          occupiedCount: 0,
          totalRoomsCount: 0,
          photos: [],
        },
        {
          roomType: "4-Sharing",
          capacity: 4,
          baseRent: 8000,
          availableBeds: 0,
          occupiedCount: 0,
          totalRoomsCount: 0,
          photos: [],
        },
      ],
      intakeMonth: currentIntakeMonth(),
      visitUrl: slug ? `/visit/${slug}` : "",
      hasLiveAvailability: false,
    };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  let siteSettings;
  try {
    siteSettings = await client.fetch(SITE_SETTINGS_QUERY, {}, { next: { tags: ["siteSettings"] } });
  } catch (err) {
    console.error("[CMS generateMetadata Error] Failed to fetch siteSettings from CMS, using fallback:", err);
  }
  
  const settings = siteSettings || fallbackSiteSettings;

  const title = settings.seoTitle;
  const description = settings.seoDescription;
  const imageUrl = settings.ownerPhoto ? urlFor(settings.ownerPhoto).url() : undefined;

  return {
    title,
    description,
    alternates: {
      canonical: settings.canonicalUrl,
    },
    openGraph: {
      title: settings.ogTitle || title,
      description: settings.ogDescription || description,
      url: settings.canonicalUrl,
      siteName: settings.seoSiteName,
      images: imageUrl
        ? [
            {
              url: imageUrl,
              alt: title,
            },
          ]
        : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: settings.ogTitle || title,
      description: settings.ogDescription || description,
      images: imageUrl ? [imageUrl] : [],
    },
  };
}

export default async function HomePage() {
  const startTime = Date.now();
  
  let siteSettings, hostel, testimonials, faqs, categoryRating, availability;
  
  try {
    const results = await Promise.all([
      client.fetch(SITE_SETTINGS_QUERY, {}, { next: { tags: ["siteSettings"] } }).catch((err) => {
        console.error("SITE_SETTINGS_QUERY fetch failed, using fallback:", err);
        return null;
      }),
      client.fetch(LANDING_HOSTEL_QUERY, {}, { next: { tags: ["landingHostel"] } }).catch((err) => {
        console.error("LANDING_HOSTEL_QUERY fetch failed, using fallback:", err);
        return null;
      }),
      client.fetch(TESTIMONIALS_QUERY, {}, { next: { tags: ["testimonial"] } }).catch((err) => {
        console.error("TESTIMONIALS_QUERY fetch failed, using fallback:", err);
        return null;
      }),
      client.fetch(FAQS_QUERY, {}, { next: { tags: ["faq"] } }).catch((err) => {
        console.error("FAQS_QUERY fetch failed, using fallback:", err);
        return null;
      }),
      client.fetch(CATEGORY_RATINGS_QUERY, {}, { next: { tags: ["categoryRating"] } }).catch((err) => {
        console.error("CATEGORY_RATINGS_QUERY fetch failed, using fallback:", err);
        return null;
      }),
      getAvailability(PRIMARY_VISIT_SLUG).catch((err) => {
        console.error("getAvailability fetch failed, using fallback:", err);
        return null;
      }),
    ]);
    [
      siteSettings,
      hostel,
      testimonials,
      faqs,
      categoryRating,
      availability,
    ] = results;
  } catch (err: any) {
    console.error(`[CMS Debug Error] Promise.all fetch failed:`, err);
  }

  // Ensure we have fallbacks for the fetched items if they are missing/failed
  if (!siteSettings) {
    siteSettings = fallbackSiteSettings;
  }
  if (!hostel) {
    hostel = {
      name: "Sunrise Residency",
      shortLocation: "Yamnampet, Secunderabad",
      locationTitle: fallbackLandingContent.hostelProfile.locationTitle,
      locationDescription: fallbackLandingContent.hostelProfile.locationDescription,
      distanceTitle: fallbackLandingContent.hostelProfile.distanceTitle,
      distanceDescription: fallbackLandingContent.hostelProfile.distanceDescription,
      mapEmbedUrl: fallbackLandingContent.hostelProfile.googleMapsEmbedUrl,
      admissionSteps: fallbackLandingContent.admissionSteps,
      facilities: fallbackLandingContent.facilities,
      gallery: fallbackLandingContent.gallery.map(g => ({ image: g.url, alt: g.alt, caption: g.caption })),
    };
  }
  if (!availability) {
    availability = {
      bedsAvailable: 40,
      totalBeds: 100,
      occupiedBeds: 60,
      reservedBeds: 0,
      occupancyRate: 60,
      startingPrice: 8200,
      sharingTypes: ["2-Sharing", "3-Sharing", "4-Sharing"],
      roomTypes: [
        {
          roomType: "4-Sharing Room",
          capacity: 4,
          baseRent: 8200,
          availableBeds: 40,
        }
      ],
      intakeMonth: "July",
      visitUrl: "",
      hasLiveAvailability: false,
    };
  }

  // Override with marketing page copy config if defined in CMS
  if (hostel) {
    if (typeof hostel.bedsAvailable === "number") {
      availability.bedsAvailable = hostel.bedsAvailable;
    }
    if (hostel.intakeMonth) {
      availability.intakeMonth = hostel.intakeMonth;
    }
  }

  const latency = Date.now() - startTime;
  console.log(`[CMS Debug] Fetch completed in ${latency}ms`);
  console.log(`[CMS Debug Query Result] hostel:`, hostel);
  console.log(`[CMS Debug Env] dataset:`, process.env.NEXT_PUBLIC_SANITY_DATASET, `projectId:`, process.env.NEXT_PUBLIC_SANITY_PROJECT_ID);
  console.log(`[CMS Debug] siteSettings: ${siteSettings ? 'LOADED' : 'MISSING'}`);
  console.log(`[CMS Debug] landingHostel (singleton): ${hostel ? `LOADED (ID: ${hostel._id || 'landingHostel'})` : 'MISSING'}`);
  console.log(`[CMS Debug] testimonials count: ${testimonials?.length || 0}`);
  console.log(`[CMS Debug] faqs count: ${faqs?.length || 0}`);
  console.log(`[CMS Debug] availability: bedsAvailable=${availability?.bedsAvailable}, startingPrice=${availability?.startingPrice}, hasLiveAvailability=${availability?.hasLiveAvailability}`);

  const testimonialsFormatted = (testimonials?.length ? testimonials : fallbackLandingContent.testimonials)?.map((t: any) => {
    const isUrlString = typeof t.image === "string" && (t.image.startsWith("http") || t.image.startsWith("/"));
    return {
      name: t.name,
      role: t.role || (t.type === "parent"
        ? `Parent of Resident · Verified Stay`
        : `${t.year || "4th"} Year · ${t.branch || "CSE"} · ${t.college || "SNIST"}`),
      review: t.quote || t.review,
      rating: t.rating || 5,
      initials: t.initials || (t.name ? t.name.split(" ").map((n: string) => n[0]).join("") : "SA"),
      image: t.image ? (isUrlString ? { url: t.image, alt: t.name } : { url: urlFor(t.image).url(), alt: t.name }) : undefined,
    };
  }) || [];

  const categoryRatingsFormatted = categoryRating ? [
    { label: "Food Quality", value: categoryRating.foodQuality || 4.9, percentage: Math.round((categoryRating.foodQuality || 4.9) * 20) },
    { label: "Cleanliness", value: categoryRating.cleanliness || 4.7, percentage: Math.round((categoryRating.cleanliness || 4.7) * 20) },
    { label: "Safety", value: categoryRating.safety || 4.8, percentage: Math.round((categoryRating.safety || 4.8) * 20) },
    { label: "Value for Money", value: categoryRating.valueForMoney || 4.6, percentage: Math.round((categoryRating.valueForMoney || 4.6) * 20) },
  ] : [
    { label: "Food Quality", value: 4.9, percentage: 98 },
    { label: "Cleanliness", value: 4.7, percentage: 94 },
    { label: "Safety", value: 4.8, percentage: 96 },
    { label: "Value for Money", value: 4.6, percentage: 92 },
  ];

  const faqsFormatted = (faqs?.length ? faqs : fallbackLandingContent.faqs)?.map((f: any) => ({
    question: f.question,
    answer: f.answer,
  })) || [];

  const galleryImagesFormatted = hostel.gallery?.map((g: any) => {
    const isUrlString = typeof g.image === "string" && (g.image.startsWith("http") || g.image.startsWith("/"));
    return {
      url: isUrlString ? g.image : (g.image ? urlFor(g.image).url() : ""),
      alt: g.alt || g.caption || "",
      caption: g.caption || "",
    };
  }) || [];

  const foodFormatted = fallbackLandingContent.food;
  const parentTrustFormatted = fallbackLandingContent.parentTrust;

  const hostelProfileForEnquiry = {
    name: hostel.name,
    phone: siteSettings.phoneNumber,
    whatsappNumber: siteSettings.whatsappNumber,
    email: siteSettings.email || "",
    shortLocation: hostel.shortLocation || "",
    addressLines: siteSettings.address ? siteSettings.address.split("\n").filter(Boolean) : [],
    locationTitle: hostel.locationTitle || "",
    locationDescription: hostel.locationDescription || "",
    distanceTitle: hostel.distanceTitle || "",
    distanceDescription: hostel.distanceDescription || "",
    googleMapsUrl: siteSettings.googleMapsUrl || "",
    googleMapsEmbedUrl: hostel.mapEmbedUrl || "",
    ownerName: siteSettings.ownerName,
    ownerMessage: siteSettings.ownerQuote || "",
    ownerPhoto: siteSettings.ownerPhoto ? (typeof siteSettings.ownerPhoto === "string" ? { url: siteSettings.ownerPhoto, alt: siteSettings.ownerName || "Owner" } : { url: urlFor(siteSettings.ownerPhoto).url(), alt: siteSettings.ownerName || "Owner" }) : undefined,
    whatsappEnquiryTemplate: siteSettings.whatsappEnquiryTemplate,
  };

  const footerContent = {
    title: hostel.name,
    description: "Providing clean, high-quality, and secure student accommodation.",
    quickLinks: [
      { label: "Home", href: "#home" },
      { label: "Facilities", href: "#facilities" },
      { label: "Rooms", href: "#rooms" },
      { label: "Location", href: "#location" },
      { label: "Contact", href: "#contact" },
    ],
    copyright: `© ${new Date().getFullYear()} ${hostel.name}. All rights reserved.`,
  };

  return (
    <div className="min-h-screen bg-[#FFFDF5]/20">
      <TopBar siteSettings={siteSettings} shortLocation={hostel.shortLocation} />
      <Navbar hostelName={hostel.name} />
      <GoogleTrustBar siteSettings={siteSettings} />
      <AnnouncementBanner announcements={siteSettings.announcements?.filter((a: any) => a.isActive) || []} />
      <Hero availability={availability} siteSettings={siteSettings} hostel={hostel} />
      <StatsStrip availability={availability} hostel={hostel} />
      <WhyChooseUs features={hostel.features || fallbackLandingContent.features} />
      <Facilities facilities={hostel.facilities || fallbackLandingContent.facilities} />
      <FoodSection food={foodFormatted} />
      <ParentTrust parentTrust={parentTrustFormatted} />
      <GallerySection images={galleryImagesFormatted} />
      <Testimonials testimonials={testimonialsFormatted} categoryRatings={categoryRatingsFormatted} />
      <AdmissionProcess steps={hostel.admissionSteps || fallbackLandingContent.admissionSteps} siteSettings={siteSettings} hostelName={hostel.name} />
      <RoomPricing availability={availability} facilities={hostel.facilities || fallbackLandingContent.facilities} siteSettings={siteSettings} hostel={hostel} />
      <Location siteSettings={siteSettings} hostel={hostel} />
      <FaqSection faqs={faqsFormatted} />
      <EnquiryForm availability={availability} hostelProfile={hostelProfileForEnquiry} visitSlug={PRIMARY_VISIT_SLUG} />
      <Footer content={footerContent} hostelProfile={hostelProfileForEnquiry} />
      <WhatsAppFAB 
        whatsappNumber={siteSettings.whatsappNumber} 
        ownerName={siteSettings.ownerName} 
        hostelName={hostel.name} 
        whatsappFABTemplate={siteSettings.whatsappFABTemplate} 
      />
      {process.env.NODE_ENV === 'development' && (
        <div id="dev-debug-panel" className="fixed bottom-4 left-4 z-50 bg-slate-900/90 text-white p-3 rounded-lg border border-slate-700 shadow-2xl text-xs font-mono max-w-sm backdrop-blur-sm">
          <div className="flex items-center justify-between mb-1.5 border-b border-slate-700 pb-1">
            <span className="font-semibold text-[#F07B1D]">CMS Debug Status</span>
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p><strong>Connection:</strong> Connected (Sanity Production)</p>
          <p><strong>Latency:</strong> {latency}ms</p>
          <p><strong>Document ID:</strong> {hostel?._id || 'landingHostel'}</p>
          <p><strong>Name:</strong> {hostel?.name || 'fallback'}</p>
          <p><strong>Beds:</strong> {availability?.bedsAvailable ?? 'N/A'} (Dynamic API)</p>
          <p><strong>Starting Price:</strong> {availability?.startingPrice ?? 'N/A'} (Dynamic API)</p>
        </div>
      )}
    </div>
  );
}
