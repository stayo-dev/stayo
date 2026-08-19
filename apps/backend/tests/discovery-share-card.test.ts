import { describe, it, expect } from "vitest";
import {
  buildShareCard,
  ogImageUrl,
  renderSharePage,
  renderUnlistedPage,
  shareDescription,
} from "@/src/services/discovery/share-card";

const base = {
  name: "Starlink",
  slug: "starlink-79ba709b",
  city: "Hyderabad",
  photos: ["https://ik.imagekit.io/stayo/hostel_listings/cover.jpg"],
  startingPrice: 8000,
  sharing: [2, 4],
  foodIncluded: true,
  verified: true,
  siteUrl: "https://yourstayo.com",
};

describe("shareDescription", () => {
  it("states only facts we hold", () => {
    expect(shareDescription(base)).toBe("From ₹8,000/month · 2-bed, 4-bed · meals included · verified on Stayo.");
  });

  it("says price on request rather than ₹0", () => {
    // An unpriced room means the owner has not said, not that the bed is free.
    expect(shareDescription({ ...base, startingPrice: null })).toContain("Price on request");
    expect(shareDescription({ ...base, startingPrice: null })).not.toContain("₹0");
  });

  it("drops claims that are not true of this hostel", () => {
    const text = shareDescription({ ...base, foodIncluded: false, verified: false });
    expect(text).not.toContain("meals");
    expect(text).not.toContain("verified");
  });

  it("groups rupees the Indian way", () => {
    expect(shareDescription({ ...base, startingPrice: 120000 })).toContain("₹1,20,000");
  });
});

describe("ogImageUrl", () => {
  it("crops an ImageKit photo to the 1200x630 card", () => {
    expect(ogImageUrl("https://ik.imagekit.io/a/b.jpg", "/fallback.png"))
      .toBe("https://ik.imagekit.io/a/b.jpg?tr=w-1200,h-630,fo-auto");
  });

  it("keeps an existing query string intact", () => {
    expect(ogImageUrl("https://ik.imagekit.io/a/b.jpg?v=2", "/fallback.png"))
      .toBe("https://ik.imagekit.io/a/b.jpg?v=2&tr=w-1200,h-630,fo-auto");
  });

  it("falls back rather than emitting a data URI no crawler renders", () => {
    expect(ogImageUrl("data:image/png;base64,AAAA", "/fallback.png")).toBe("/fallback.png");
  });

  it("falls back when the hostel has no photo at all", () => {
    expect(ogImageUrl(undefined, "/fallback.png")).toBe("/fallback.png");
  });

  it("passes a non-ImageKit absolute url through untouched", () => {
    expect(ogImageUrl("https://cdn.example.com/x.jpg", "/f.png")).toBe("https://cdn.example.com/x.jpg");
  });
});

describe("buildShareCard", () => {
  it("shares the short url and sends humans to the listing", () => {
    const card = buildShareCard(base);
    expect(card.shareUrl).toBe("https://yourstayo.com/h/starlink-79ba709b");
    expect(card.listingUrl).toBe("https://yourstayo.com/discover/h/starlink-79ba709b");
  });

  it("names the city in the title", () => {
    expect(buildShareCard(base).title).toBe("Starlink — Hyderabad on Stayo");
    expect(buildShareCard({ ...base, city: null }).title).toBe("Starlink on Stayo");
  });

  it("uses the site cover when the hostel has no photos", () => {
    expect(buildShareCard({ ...base, photos: [] }).imageUrl).toBe("https://yourstayo.com/og-cover.png");
  });

  it("tolerates a trailing slash on the site url", () => {
    expect(buildShareCard({ ...base, siteUrl: "https://yourstayo.com/" }).shareUrl)
      .toBe("https://yourstayo.com/h/starlink-79ba709b");
  });
});

describe("renderSharePage", () => {
  const html = renderSharePage(buildShareCard(base));

  it("carries the tags a chat app unfurls", () => {
    expect(html).toContain('<meta property="og:title" content="Starlink — Hyderabad on Stayo" />');
    expect(html).toContain('property="og:image" content="https://ik.imagekit.io/stayo/hostel_listings/cover.jpg?tr=w-1200,h-630,fo-auto"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  it("points canonical at the listing, not at itself", () => {
    expect(html).toContain('<link rel="canonical" href="https://yourstayo.com/discover/h/starlink-79ba709b" />');
  });

  it("moves a human on without leaving itself in history", () => {
    expect(html).toContain('location.replace("https://yourstayo.com/discover/h/starlink-79ba709b")');
    // JS-less clients still get out — the page is never a dead end.
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('href="https://yourstayo.com/discover/h/starlink-79ba709b"');
  });

  it("escapes a hostel name, which is owner-authored input", () => {
    const html = renderSharePage(buildShareCard({ ...base, name: 'Sunny "Boys" <script>alert(1)</script>' }));
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&quot;Boys&quot;");
  });
});

describe("renderUnlistedPage", () => {
  const html = renderUnlistedPage("https://yourstayo.com");

  it("never unfurls a suspended hostel's identity", () => {
    // The whole point: a link already pasted into fifty chats must stop
    // showing this hostel the moment it is de-listed.
    expect(html).not.toContain("Starlink");
    expect(html).toContain('content="https://yourstayo.com/og-cover.png"');
  });

  it("keeps itself out of search results", () => {
    expect(html).toContain('<meta name="robots" content="noindex" />');
  });
});
