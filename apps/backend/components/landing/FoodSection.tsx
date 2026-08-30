'use client';

import { useState } from 'react';
import { Utensils, CheckCircle, Quote } from 'lucide-react';
import { ScrollReveal } from './ScrollReveal';
import type { FoodContent } from '@/lib/sanity/landingContent';

export function FoodSection({ food }: { food?: FoodContent }) {
  const [activeDay, setActiveDay] = useState(0);

  if (!food) return null;

  const weeklyMenu = food.weeklyMenu || [];
  const highlights = food.foodHighlights || [];
  const images = food.images || [];

  return (
    <section id="food" className="py-16 md:py-24 bg-[#FFFDF5]/40 border-t border-[#F07B1D]/10">
      <div className="max-w-7xl mx-auto px-4">
        
        {/* Header */}
        <ScrollReveal>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="inline-flex items-center gap-2 bg-[#F07B1D]/10 text-[#F07B1D] px-4 py-2 rounded-full text-sm font-semibold mb-4">
              <Utensils className="w-4 h-4" />
              <span>Homely Mess & Dining</span>
            </div>
            <h2 
              className="text-3xl md:text-5xl font-extrabold text-[#1B2D5B] mb-6 tracking-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {food.title}
            </h2>
            <p className="text-lg text-[#2C2C2A]/80 leading-relaxed">
              {food.description}
            </p>
          </div>
        </ScrollReveal>

        {/* Content Grid */}
        <div className="grid lg:grid-cols-12 gap-12 items-start">
          
          {/* Left: Highlights & Parent Trust */}
          <div className="lg:col-span-5 space-y-8">
            <ScrollReveal delay={0.2}>
              <div className="bg-white p-8 rounded-2xl shadow-lg border border-[#F07B1D]/10">
                <h3 className="text-xl font-bold text-[#1B2D5B] mb-6 flex items-center gap-2">
                  <span>Dining Hall Inclusions</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {highlights.map((highlight, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
                      <span className="text-[#2C2C2A] font-semibold text-sm">{highlight}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>

            {/* Parent Quote Testimonial */}
            {food.parentQuote && (
              <ScrollReveal delay={0.3}>
                <div className="bg-gradient-to-br from-[#1B2D5B] to-[#253f80] text-white p-8 rounded-2xl shadow-xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 opacity-10 text-white">
                    <Quote className="w-32 h-32" />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-1.5 mb-4 text-[#F07B1D]">
                      <span className="text-sm font-bold uppercase tracking-wider">★ Parents Approve Sunrise Residency</span>
                    </div>
                    <p className="text-[#FFFDF5]/90 italic text-base leading-relaxed mb-6 font-medium">
                      "{food.parentQuote}"
                    </p>
                    <div className="flex items-center gap-4">
                      {food.parentPhotoUrl ? (
                        <img 
                          src={food.parentPhotoUrl} 
                          alt={food.parentName || 'Parent'} 
                          className="w-12 h-12 rounded-full object-cover border-2 border-[#F07B1D]"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-[#F07B1D] flex items-center justify-center font-bold text-white">
                          P
                        </div>
                      )}
                      <div>
                        <h4 className="font-bold text-white text-sm">{food.parentName}</h4>
                        <p className="text-xs text-[#FFFDF5]/70">Verified Parent Feedback</p>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            )}
          </div>

          {/* Right: Dynamic Weekly Menu Scheduler */}
          <div className="lg:col-span-7">
            {weeklyMenu.length > 0 && (
              <ScrollReveal delay={0.4}>
                <div className="bg-white rounded-2xl shadow-xl border border-[#F07B1D]/15 overflow-hidden">
                  
                  {/* Tabs Bar */}
                  <div className="flex border-b border-[#F07B1D]/10 overflow-x-auto scrollbar-thin">
                    {weeklyMenu.map((menu, index) => (
                      <button
                        key={menu.day}
                        onClick={() => setActiveDay(index)}
                        className={`flex-1 min-w-[90px] py-4 text-center font-bold text-sm transition-colors relative whitespace-nowrap px-3 ${
                          activeDay === index 
                            ? 'text-[#F07B1D] bg-[#FFFDF5]/50' 
                            : 'text-[#2C2C2A]/60 hover:text-[#1B2D5B]'
                        }`}
                      >
                        {menu.day.substring(0, 3)}
                        {activeDay === index && (
                          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F07B1D]" />
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Tab Details */}
                  <div className="p-8">
                    <h3 className="text-2xl font-bold text-[#1B2D5B] mb-6 flex items-center justify-between">
                      <span>{weeklyMenu[activeDay].day}'s Mess Schedule</span>
                      <span className="text-xs font-semibold text-[#F07B1D] bg-[#F07B1D]/10 px-2.5 py-1 rounded-full">
                        Unlimited Meals
                      </span>
                    </h3>

                    <div className="space-y-6">
                      
                      {/* Breakfast */}
                      <div className="flex items-start gap-4 p-4 rounded-xl hover:bg-[#FFFDF5]/30 transition-colors">
                        <div className="bg-[#F07B1D]/15 text-[#F07B1D] p-3 rounded-lg font-bold text-xs uppercase tracking-wider w-24 text-center flex-shrink-0">
                          8:00 AM
                        </div>
                        <div>
                          <h4 className="font-extrabold text-[#1B2D5B] text-sm">Breakfast</h4>
                          <p className="text-[#2C2C2A]/85 mt-1 text-sm">{weeklyMenu[activeDay].breakfast}</p>
                        </div>
                      </div>

                      {/* Lunch */}
                      <div className="flex items-start gap-4 p-4 rounded-xl hover:bg-[#FFFDF5]/30 transition-colors">
                        <div className="bg-[#1B2D5B]/10 text-[#1B2D5B] p-3 rounded-lg font-bold text-xs uppercase tracking-wider w-24 text-center flex-shrink-0">
                          1:00 PM
                        </div>
                        <div>
                          <h4 className="font-extrabold text-[#1B2D5B] text-sm">Lunch</h4>
                          <p className="text-[#2C2C2A]/85 mt-1 text-sm">{weeklyMenu[activeDay].lunch}</p>
                        </div>
                      </div>

                      {/* Dinner */}
                      <div className="flex items-start gap-4 p-4 rounded-xl hover:bg-[#FFFDF5]/30 transition-colors">
                        <div className="bg-green-50 text-green-700 p-3 rounded-lg font-bold text-xs uppercase tracking-wider w-24 text-center flex-shrink-0">
                          8:00 PM
                        </div>
                        <div>
                          <h4 className="font-extrabold text-[#1B2D5B] text-sm">Dinner</h4>
                          <p className="text-[#2C2C2A]/85 mt-1 text-sm">{weeklyMenu[activeDay].dinner}</p>
                        </div>
                      </div>

                    </div>
                  </div>

                </div>
              </ScrollReveal>
            )}

            {/* Food Gallery Images */}
            {images.length > 0 && (
              <ScrollReveal delay={0.5}>
                <div className="mt-8 grid grid-cols-2 md:grid-cols-3 gap-4">
                  {images.slice(0, 3).map((img, idx) => (
                    <div key={idx} className="aspect-[4/3] rounded-xl overflow-hidden shadow border border-[#F07B1D]/5 group relative">
                      <img 
                        src={img.url} 
                        alt={img.alt || img.caption || 'Food Item'} 
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      {img.caption && (
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                          <p className="text-white text-xs font-semibold">{img.caption}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollReveal>
            )}
          </div>

        </div>

      </div>
    </section>
  );
}
