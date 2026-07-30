'use client';

import Link from 'next/link';
import { Phone, MapPin, MessageCircle } from 'lucide-react';
import { ScrollReveal } from './ScrollReveal';
import type { FooterContent, HostelProfileContent } from '@lib/sanity/landingContent';
import { fallbackLandingContent } from '@lib/sanity/client';

export function Footer({
  content = fallbackLandingContent.footer,
  hostelProfile = fallbackLandingContent.hostelProfile,
}: {
  content?: FooterContent;
  hostelProfile?: HostelProfileContent;
}) {
  const profile = { ...fallbackLandingContent.hostelProfile, ...hostelProfile };
  const phone = profile.phone;
  const whatsappNumber = profile.whatsappNumber;
  const footerLocation = profile.shortLocation || profile.addressLines?.join(', ') || '';

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <footer className="bg-[#1B2D5B] text-white py-12">
      <ScrollReveal>
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-white flex items-center justify-center">
                  <img
                    src="/hostel_icon.jpeg"
                    alt={`${content.title} Logo`}
                    className="w-10 h-10 object-contain"
                  />
                </div>
                <div>
                  <h3
                    className="text-xl font-semibold"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {content.title}
                  </h3>
                </div>
              </div>
              <p className="text-white/80 text-sm">
                {content.description}
              </p>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Quick Links</h4>
              <div className="space-y-2">
                {content.quickLinks.map((link) =>
                  link.href.startsWith('#') ? (
                    <button
                      key={link.href}
                      onClick={() => scrollToSection(link.href.slice(1))}
                      className="block text-white/80 hover:text-white transition-colors text-sm"
                    >
                      {link.label}
                    </button>
                  ) : link.href.startsWith('/') ? (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="block text-white/80 hover:text-white transition-colors text-sm"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      key={link.href}
                      href={link.href}
                      className="block text-white/80 hover:text-white transition-colors text-sm"
                    >
                      {link.label}
                    </a>
                  ),
                )}
              </div>
            </div>

            <div>
              <h4 className="font-semibold mb-4">Contact Us</h4>
              <div className="space-y-3 text-sm">
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                >
                  <Phone className="w-4 h-4" />
                  <span>{phone}</span>
                </a>
                <a
                  href={`https://api.whatsapp.com/send?phone=${whatsappNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>WhatsApp</span>
                </a>
                <div className="flex items-start gap-2 text-white/80">
                  <MapPin className="w-4 h-4 mt-1 flex-shrink-0" />
                  <span>{footerLocation}</span>
                </div>
              </div>
            </div>
          </div>

        <div className="border-t border-white/20 pt-8 text-center text-sm text-white/60">
          <p>{content.copyright}</p>
        </div>
        </div>
      </ScrollReveal>
    </footer>
  );
}
