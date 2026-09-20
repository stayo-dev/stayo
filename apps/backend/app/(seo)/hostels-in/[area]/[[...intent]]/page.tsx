import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { loadCollectionPage } from "@/src/services/seo/seo-service";
import { normaliseSlug } from "@/src/services/seo/slug";
import { ogImageUrl } from "@/src/services/discovery/share-card";
import { frontendUrl } from "@/lib/config/domains";
import { CollectionPage } from "../../../_components/CollectionPage";

/**
 * `/hostels-in/:area` and its filtered variants.
 *
 * An optional catch-all, so the unfiltered page and its intent variants are
 * ONE route. They are the same page with one extra predicate; splitting them
 * across two files is how the two drift apart.
 *
 * Anything not on the closed intent allowlist 404s. Without that,
 * `/hostels-in/:area/:anything` is unbounded crawl space — and a crawler
 * that finds one on a small site spends its budget there instead of on the
 * hostels. See ADR-226.
 */
export const revalidate = 3600;
export const dynamicParams = true;

type Params = { params: { area: string; intent?: string[] } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const page = await loadCollectionPage("area", params.area, params.intent);
  if (page.status !== "ok" || !page.spec) {
    return { title: "Page not found | Stayo", robots: { index: false, follow: true } };
  }

  const { spec } = page;
  const image = ogImageUrl(spec.image ?? undefined, frontendUrl("/og-cover.png"));

  return {
    title: spec.title,
    description: spec.description,
    alternates: { canonical: spec.canonicalUrl },
    robots: { index: spec.robots.index, follow: spec.robots.follow },
    openGraph: {
      type: "website",
      siteName: "Stayo",
      title: spec.title,
      description: spec.description,
      url: spec.canonicalUrl,
      locale: "en_IN",
      images: [{ url: image, width: 1200, height: 630, alt: spec.h1 }],
    },
    twitter: {
      card: "summary_large_image",
      title: spec.title,
      description: spec.description,
      images: [image],
    },
  };
}

export default async function Page({ params }: Params) {
  const slug = normaliseSlug(params.area);
  if (slug !== params.area) {
    // One page, one address: an uppercase or trailing-slash variant must not
    // also serve 200.
    const tail = params.intent?.length ? `/${params.intent.join("/")}` : "";
    permanentRedirect(`/hostels-in/${slug}${tail}`);
  }

  const page = await loadCollectionPage("area", slug, params.intent);
  if (page.status !== "ok") notFound();

  return <CollectionPage page={page} />;
}
