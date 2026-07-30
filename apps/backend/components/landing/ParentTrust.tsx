'use client';

import { Shield, Eye, Bell, Heart } from 'lucide-react';
import { ScrollReveal } from './ScrollReveal';
import type { ParentTrustContent } from '@/lib/sanity/landingContent';

function getIconComponent(iconName: string) {
  switch (iconName?.toLowerCase()) {
    case 'warden':
      return Shield;
    case 'cctv':
      return Eye;
    case 'whatsapp':
    case 'updates':
      return Bell;
    case 'emergency':
    case 'medical':
      return Heart;
    default:
      return Shield;
  }
}

export function ParentTrust({ parentTrust }: { parentTrust?: ParentTrustContent }) {
  if (!parentTrust) return null;

  const points = parentTrust.points || [];

  return (
    <section id="trust" className="py-16 md:py-24 bg-white border-t border-[#F07B1D]/10">
      <div className="max-w-7xl mx-auto px-4">
        
        {/* Header */}
        <ScrollReveal>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 
              className="text-3xl md:text-5xl font-extrabold text-[#1B2D5B] mb-6 tracking-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {parentTrust.title}
            </h2>
            {parentTrust.subtitle && (
              <p className="text-lg text-[#2C2C2A]/80 leading-relaxed">
                {parentTrust.subtitle}
              </p>
            )}
          </div>
        </ScrollReveal>

        {/* Content Layout */}
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          
          {/* Left Column: Image with security seal */}
          {parentTrust.imageUrl && (
            <div className="lg:col-span-5 relative">
              <ScrollReveal delay={0.2}>
                <div className="relative rounded-2xl overflow-hidden shadow-2xl border-4 border-[#FFFDF5]">
                  <img 
                    src={parentTrust.imageUrl} 
                    alt="Hostel Security and Warden" 
                    className="w-full h-auto object-cover max-h-[480px]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  
                  {/* Security Badge */}
                  <div className="absolute bottom-6 left-6 right-6 bg-white/95 backdrop-blur-sm p-4 rounded-xl shadow-lg border border-[#F07B1D]/20 flex items-center gap-4">
                    <div className="bg-[#F07B1D]/10 p-3 rounded-lg text-[#F07B1D] flex-shrink-0">
                      <Shield className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-[#1B2D5B] text-sm">Safe & Disciplined environment</h4>
                      <p className="text-xs text-[#2C2C2A]/80">Zero tolerance for ragging and smoking.</p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            </div>
          )}

          {/* Right Column: Grid of Trust Points */}
          <div className={`${parentTrust.imageUrl ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-6`}>
            <div className="grid sm:grid-cols-2 gap-6">
              {points.map((point, index) => {
                const IconComponent = getIconComponent(point.icon || 'warden');
                return (
                  <ScrollReveal key={index} delay={0.3 + index * 0.1}>
                    <div className="p-6 rounded-2xl bg-[#FFFDF5]/40 hover:bg-[#FFFDF5] border border-[#F07B1D]/10 hover:border-[#F07B1D]/35 transition-all duration-300 shadow-sm flex flex-col h-full">
                      <div className="bg-[#F07B1D] text-white p-3 rounded-xl w-12 h-12 flex items-center justify-center mb-4 shadow-md">
                        <IconComponent className="w-6 h-6" />
                      </div>
                      <h3 className="text-lg font-bold text-[#1B2D5B] mb-2">{point.title}</h3>
                      <p className="text-[#2C2C2A]/80 text-sm leading-relaxed mt-auto">{point.description}</p>
                    </div>
                  </ScrollReveal>
                );
              })}
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
