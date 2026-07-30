"use client";

import { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';
import type { GalleryImageContent } from '@lib/sanity/landingContent';

export function GallerySection({ images = [] }: { images?: GalleryImageContent[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  const showNext = () => {
    if (selectedIndex !== null) {
      setSelectedIndex((selectedIndex + 1) % images.length);
    }
  };

  const showPrev = () => {
    if (selectedIndex !== null) {
      setSelectedIndex((selectedIndex - 1 + images.length) % images.length);
    }
  };

  const close = () => setSelectedIndex(null);

  // Keyboard navigation
  useEffect(() => {
    if (selectedIndex === null) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') showNext();
      else if (e.key === 'ArrowLeft') showPrev();
      else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex]);

  // Prevent background scroll
  useEffect(() => {
    if (selectedIndex !== null) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedIndex]);

  // Touch handlers for swipe navigation
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      showNext();
    } else if (isRightSwipe) {
      showPrev();
    }
    setTouchStart(null);
    setTouchEnd(null);
  };

  if (!images.length) return null;

  const currentImage = selectedIndex !== null ? images[selectedIndex] : null;

  return (
    <section className="bg-white py-10 md:py-24" id="gallery">
      <div className="mx-auto max-w-7xl px-4">
        <ScrollReveal>
          <h2
            className="mb-4 text-center text-3xl text-[#1B2D5B] md:text-4xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Hostel Gallery
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="mx-auto mb-12 max-w-2xl text-center text-[#2C2C2A]">
            A closer look at rooms, food, facilities, and daily hostel life.
          </p>
        </ScrollReveal>

        <StaggerReveal staggerDelay={0.08}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((image, index) => (
              <StaggerItem key={`${image.url}-${index}`}>
                <article
                  onClick={() => setSelectedIndex(index)}
                  className="relative overflow-hidden rounded-2xl border border-[#F07B1D]/10 bg-[#FFFDF5] shadow-md aspect-[4/3] group cursor-pointer"
                >
                  <img
                    src={image.url}
                    alt={image.alt}
                    loading={index < 2 ? 'eager' : 'lazy'}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                  {(image.caption || image.title || image.category) && (
                    <div className="absolute bottom-3 left-3 right-3 flex flex-col items-start gap-1">
                      {image.category && (
                        <span className="bg-[#F07B1D] text-white text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full font-bold">
                          {image.category}
                        </span>
                      )}
                      <div className="bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-semibold text-white max-w-[95%] truncate border border-white/10">
                        {image.caption || image.title}
                      </div>
                    </div>
                  )}
                </article>
              </StaggerItem>
            ))}
          </div>
        </StaggerReveal>
      </div>

      {/* Fullscreen Lightbox Modal */}
      {selectedIndex !== null && currentImage && (
        <div
          className="fixed inset-0 z-[150] flex flex-col items-center justify-between bg-black/95 backdrop-blur-md p-4 transition-all duration-300"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Top Bar */}
          <div className="flex w-full items-center justify-between max-w-5xl z-10">
            <span className="text-white/60 text-xs font-semibold">
              Hostel Gallery ({selectedIndex + 1} / {images.length})
            </span>
            <button
              onClick={close}
              className="flex items-center justify-center rounded-full p-2.5 text-white bg-white/10 hover:bg-white/20 border border-white/10 transition-colors focus:outline-none cursor-pointer"
              aria-label="Close fullscreen view"
            >
              <X size={20} />
            </button>
          </div>

          {/* Image Container */}
          <div className="relative flex flex-1 items-center justify-center w-full max-w-5xl my-4">
            {/* Left Nav Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                showPrev();
              }}
              className="absolute left-2 md:left-4 z-10 flex items-center justify-center rounded-full p-3 text-white bg-black/40 hover:bg-black/60 hover:scale-105 border border-white/15 transition-all focus:outline-none cursor-pointer select-none"
              aria-label="Previous image"
            >
              <ChevronLeft size={24} />
            </button>

            {/* Main Image */}
            <img
              src={currentImage.url}
              alt={currentImage.alt}
              className="max-h-[72vh] md:max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl transition-transform duration-300"
            />

            {/* Right Nav Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                showNext();
              }}
              className="absolute right-2 md:right-4 z-10 flex items-center justify-center rounded-full p-3 text-white bg-black/40 hover:bg-black/60 hover:scale-105 border border-white/15 transition-all focus:outline-none cursor-pointer select-none"
              aria-label="Next image"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Bottom Caption Bar */}
          <div className="text-center bg-white/10 border border-white/10 backdrop-blur-sm px-6 py-3.5 rounded-2xl max-w-lg w-full mx-4 shadow-xl z-10">
            {currentImage.category && (
              <span className="bg-[#F07B1D] text-white text-[9px] uppercase tracking-widest px-2.5 py-1 rounded-full font-bold inline-block mb-2 shadow-sm">
                {currentImage.category}
              </span>
            )}
            <p className="text-white font-medium text-xs md:text-sm">
              {currentImage.caption || currentImage.title}
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
