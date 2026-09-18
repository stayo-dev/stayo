import { ANCHOR_OFFSET, GROUND_LIGHT } from './ground';

const STEPS = [
  { n: '1', title: 'Browse', body: 'Real photos, real prices, and how many beds are actually free.' },
  { n: '2', title: 'Enquire', body: 'Your enquiry goes straight to the owner — no agent in between.' },
  { n: '3', title: 'Visit', body: 'See it yourself, with your parents if you want. Book a time.' },
  { n: '4', title: 'Move in', body: 'Agreement, rent and receipts all live in one place afterwards.' },
];

export function HowItWorks() {
  return (
    <section id="how" className={`px-4 pb-16 sm:px-6 sm:pb-20 ${GROUND_LIGHT} ${ANCHOR_OFFSET}`}>
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-[clamp(26px,3.2vw,32px)] font-extrabold tracking-tight text-foreground">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary font-display text-[15px] font-extrabold text-primary-foreground">
                {step.n}
              </span>
              <h3 className="mt-3.5 font-display text-lg font-extrabold text-foreground">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
