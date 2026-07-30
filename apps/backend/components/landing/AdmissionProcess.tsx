import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';
import type { AdmissionStepContent } from '@lib/sanity/landingContent';
import { getLandingIcon } from './content/icons';
import { MessageCircle } from 'lucide-react';

const derivedIcons = ['phone', 'building', 'bed', 'document', 'key'];

export function AdmissionProcess({
  steps = [],
  siteSettings,
  hostelName,
}: {
  steps?: AdmissionStepContent[];
  siteSettings: any;
  hostelName: string;
}) {
  const safeSteps = steps.filter((step) => (step?.stepNumber || step?.step) && step?.title && step?.description);
  const whatsappNumber = siteSettings.whatsappNumber;
  const template = siteSettings.whatsappAdmissionTemplate || "Hi, I'm interested in seeking admission at {hostelName}";
  const message = template.replace("{hostelName}", hostelName);
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  if (!safeSteps.length) return null;

  return (
    <section className="py-10 md:py-24 bg-[#FFFDF5]">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-3 md:mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            How Admission Works
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <p className="text-center text-[#2C2C2A] mb-8 md:mb-12 max-w-2xl mx-auto">
            Simple. Transparent. No surprises.
          </p>
        </ScrollReveal>

        <StaggerReveal>
          <div className="hidden md:flex justify-between items-start relative max-w-5xl mx-auto">
            {safeSteps.map((step, index) => {
              const isFinal = index === safeSteps.length - 1;
              const Icon = getLandingIcon(derivedIcons[index] || 'phone', 'phone');
              return (
                <StaggerItem key={index}>
                  <div className="flex flex-col items-center relative" style={{ width: '180px' }}>
                    {index < safeSteps.length - 1 && (
                      <div className="absolute left-full top-6 w-full h-px border-t-2 border-dashed border-[#F07B1D]/30" style={{ marginLeft: '24px', width: 'calc(100% - 48px)' }} />
                    )}

                    <div className={`w-12 h-12 rounded-full ${isFinal ? 'bg-[#1B2D5B]' : 'bg-[#F07B1D]'} text-white flex items-center justify-center font-bold text-xl mb-4 relative z-10`}>
                      {step.stepNumber ?? step.step}
                    </div>

                    <div className={`w-14 h-14 rounded-full ${isFinal ? 'bg-[#1B2D5B]/10' : 'bg-[#F07B1D]/10'} flex items-center justify-center mb-3`}>
                      <Icon className={`w-7 h-7 ${isFinal ? 'text-[#1B2D5B]' : 'text-[#F07B1D]'}`} />
                    </div>

                    <h3 className="font-semibold text-[#1B2D5B] mb-2 text-center text-sm">
                      {step.title}
                    </h3>

                    <p className="text-[#2C2C2A]/70 text-center text-xs leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </StaggerItem>
              );
            })}
          </div>

          <div className="md:hidden">
            <div className="relative overflow-hidden rounded-2xl border border-[#F07B1D]/15 bg-white p-4 shadow-lg">
              <div className="absolute left-[46px] top-8 bottom-8 w-px bg-gradient-to-b from-[#F07B1D] via-[#F07B1D]/45 to-[#1B2D5B]" />
              <div className="relative space-y-3">
                {safeSteps.map((step, index) => {
                  const isFinal = index === safeSteps.length - 1;
                  const Icon = getLandingIcon(derivedIcons[index] || 'phone', 'phone');
                  return (
                    <div key={step.stepNumber ?? step.step} className="relative flex items-center gap-3 rounded-xl bg-[#FFFDF5] px-3 py-3">
                      <div className={`relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${isFinal ? 'bg-[#1B2D5B]' : 'bg-[#F07B1D]'} text-sm font-bold text-white shadow-sm`}>
                        {step.stepNumber ?? step.step}
                      </div>
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${isFinal ? 'bg-[#1B2D5B]/10' : 'bg-[#F07B1D]/10'}`}>
                        <Icon className={`h-4 w-4 ${isFinal ? 'text-[#1B2D5B]' : 'text-[#F07B1D]'}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold leading-tight text-[#1B2D5B]">
                          {step.title}
                        </h3>
                        <p className="mt-0.5 text-xs leading-snug text-[#2C2C2A]/70">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </StaggerReveal>

        <ScrollReveal delay={0.5}>
          <div className="mt-6 md:mt-12 max-w-2xl mx-auto space-y-6">
            <div className="bg-[#F07B1D]/10 border-l-4 border-[#F07B1D] rounded-lg p-3 md:p-4 text-center">
              <p className="text-[#1B2D5B] font-semibold text-sm md:text-base">
                Most students complete admission in under 48 hours.
              </p>
            </div>
            
            <div className="flex justify-center">
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#F07B1D] text-white px-8 py-3.5 rounded-lg hover:bg-[#d96e18] transition-colors font-bold shadow-md w-full sm:w-auto justify-center text-center text-sm md:text-base"
              >
                <MessageCircle className="w-5 h-5" />
                <span>WhatsApp to Start Admission</span>
              </a>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
