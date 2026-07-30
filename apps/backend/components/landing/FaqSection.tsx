'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';
import type { FaqContent } from '@lib/sanity/landingContent';

const DEFAULT_FAQS: FaqContent[] = [
  {
    question: "What kind of food is served and how is quality maintained?",
    answer: "We serve 3 hot, hygienic meals daily (Breakfast, Lunch & Dinner) prepared by professional cooks on site. Highlights include special Sunday chicken biryani and vegetable pulao. We only use RO purified drinking water and maintain clean, sanitised kitchen premises."
  },
  {
    question: "How far is the hostel from SNIST and how do students commute?",
    answer: "The hostel is located just 400 metres from the SNIST main gate. It is a safe 3-to-5-minute walk along a well-lit path, eliminating any need for auto or bus travel for daily classes."
  },
  {
    question: "What security measures are in place for students?",
    answer: "We take student safety very seriously. The hostel has 24/7 CCTV surveillance across all corridors and entry points, a secure biometric gate control system, and the warden/owner resides on-site to assist students at any hour."
  },
  {
    question: "Is high-speed Wi-Fi available for online classes and study?",
    answer: "Yes, we provide free high-speed commercial Wi-Fi coverage across all rooms and common study areas to ensure SNIST students can study and work on projects without interruption."
  },
  {
    question: "What happens in case of a medical emergency?",
    answer: "The warden resides on the premises and has emergency transport ready 24/7. We maintain a basic first-aid kit, have access to nearby clinics in Yamnampet, and immediately coordinate with parents."
  },
  {
    question: "Are power backup facilities available?",
    answer: "Yes, we have power backup systems installed for basic lights, fans, and Wi-Fi router operations so that studies are not disrupted during power cuts."
  },
  {
    question: "What is the policy on rent advance, deposits, and refunds?",
    answer: "We charge a transparent monthly rent with a one-month rent advance. There are no hidden maintenance or electricity charges. Refund terms are fully documented in the stay agreement."
  },
  {
    question: "Can parents visit or stay at the hostel?",
    answer: "Parents are always welcome to visit the hostel during visiting hours. If a parent needs to stay overnight during admission or under special circumstances, we can arrange accommodation in a guest room (subject to availability)."
  }
];

export function FaqSection({ faqs = [] }: { faqs?: FaqContent[] }) {
  // Merge custom Sanity FAQs with DEFAULT_FAQS to ensure a minimum of 8 robust FAQs
  const combinedFaqs = [...faqs];
  DEFAULT_FAQS.forEach((defaultFaq) => {
    if (!combinedFaqs.some(f => f.question?.toLowerCase().trim() === defaultFaq.question.toLowerCase().trim())) {
      combinedFaqs.push(defaultFaq);
    }
  });

  const safeFaqs = combinedFaqs.filter((faq) => faq?.question && faq?.answer);

  // Pre-select/expand the 'Meals & Food Quality' question by default
  const defaultOpenFaq = safeFaqs.find(
    f => f.question.toLowerCase().includes('food') || f.question.toLowerCase().includes('meal')
  )?.question || safeFaqs[0]?.question || null;

  const [openQuestion, setOpenQuestion] = useState<string | null>(defaultOpenFaq);

  if (!safeFaqs.length) return null;

  return (
    <section className="py-16 md:py-24 bg-[#FFFDF5]">
      <div className="max-w-4xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Questions Parents & Students Ask
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="text-center text-[#2C2C2A] mb-10 font-medium">
            Clear answers before you plan a visit.
          </p>
        </ScrollReveal>

        <StaggerReveal staggerDelay={0.08}>
          <div className="space-y-3">
            {safeFaqs.map((faq) => {
              const isOpen = openQuestion === faq.question;
              return (
                <StaggerItem key={faq.question}>
                  <article className="rounded-xl border border-[#F07B1D]/15 bg-white shadow-sm overflow-hidden transition-all duration-300">
                    <button
                      type="button"
                      onClick={() => setOpenQuestion(isOpen ? null : faq.question)}
                      className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[#FFFDF5]/40 transition-colors"
                    >
                      <div>
                        <h3 className="font-bold text-[#1B2D5B] text-sm md:text-base">{faq.question}</h3>
                      </div>
                      <ChevronDown className={`h-5 w-5 flex-shrink-0 text-[#F07B1D] transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <p className="border-t border-[#F07B1D]/10 px-5 py-4 text-xs md:text-sm leading-6 text-[#2C2C2A]/85 bg-[#FFFDF5]/20 font-medium">
                        {faq.answer}
                      </p>
                    )}
                  </article>
                </StaggerItem>
              );
            })}
          </div>
        </StaggerReveal>
      </div>
    </section>
  );
}
