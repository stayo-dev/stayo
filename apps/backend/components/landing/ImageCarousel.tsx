'use client';

import { useState, useEffect, useRef } from 'react';
import { Building2, UtensilsCrossed, Bed } from 'lucide-react';
import type { MarketingImage } from '@lib/sanity/landingContent';

function iconForLabel(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('food') || normalized.includes('meal')) return UtensilsCrossed;
  if (normalized.includes('room') || normalized.includes('bed')) return Bed;
  return Building2;
}

export function ImageCarousel({ images }: { images?: MarketingImage[] }) {
  const slides = images?.map((image) => ({
    label: image.caption || image.alt,
    icon: iconForLabel(image.caption || image.alt),
    image: image.url,
    alt: image.alt,
  })) || [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef<number | null>(null);
  const dragDeltaX = useRef(0);

  useEffect(() => {
    if (!slides.length || isHovered || isDragging) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [isHovered, isDragging, slides.length]);

  const goToSlide = (index: number) => {
    setCurrentIndex((index + slides.length) % slides.length);
  };

  const handleSwipeEnd = () => {
    const delta = dragDeltaX.current;
    dragStartX.current = null;
    dragDeltaX.current = 0;
    setIsDragging(false);

    if (Math.abs(delta) < 48) return;
    goToSlide(currentIndex + (delta < 0 ? 1 : -1));
  };

  if (!slides.length) return null;

  return (
    <div
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="overflow-hidden rounded-2xl shadow-lg cursor-grab active:cursor-grabbing select-none"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={(event) => {
          dragStartX.current = event.clientX;
          dragDeltaX.current = 0;
          setIsDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragStartX.current == null) return;
          dragDeltaX.current = event.clientX - dragStartX.current;
        }}
        onPointerUp={(event) => {
          if (dragStartX.current == null) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          handleSwipeEnd();
        }}
        onPointerCancel={handleSwipeEnd}
      >
        <div
          className={`flex transition-transform ease-in-out ${isDragging ? 'duration-200' : 'duration-500'}`}
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {slides.map((slide, index) => {
            const Icon = slide.icon;
            return (
              <div
                key={index}
                className="w-full flex-shrink-0"
              >
                <div className="aspect-[4/3] relative overflow-hidden bg-[#FFFDF5]">
                  <img
                    src={slide.image}
                    alt={'alt' in slide ? slide.alt : slide.label}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  <div className="absolute bottom-5 left-5 flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-[#1B2D5B] shadow-sm backdrop-blur-sm">
                    <Icon className="h-4 w-4 text-[#F07B1D]" />
                    <span>{slide.label}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-center gap-2 mt-4">
        {slides.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? 'bg-[#F07B1D] w-6'
                : 'bg-[#F07B1D]/30 hover:bg-[#F07B1D]/50'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
