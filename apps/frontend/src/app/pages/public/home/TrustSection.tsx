import { CreditCard, FileCheck2, ShieldCheck, Users } from 'lucide-react';

import { GROUND_LIGHT } from './ground';

const FACTS = [
  { Icon: ShieldCheck, title: 'Visited before listed', body: 'Every hostel is verified by us before it can appear here.' },
  { Icon: Users, title: 'Straight to the owner', body: 'Your enquiry goes to the person who runs the hostel, not an agent.' },
  { Icon: FileCheck2, title: 'Agreement in writing', body: 'A digital agreement and receipts you can actually produce later.' },
  { Icon: CreditCard, title: 'Licensed payment rails', body: 'Rent moves through a regulated aggregator, not a personal account.' },
];

/**
 * The brand spine — a claim about the channel, never about money.
 *
 * An earlier draft led with "Stayo earns nothing from your rent". A planned
 * per-converted-tenant fee makes that unsafe, and the amount is not settled, so
 * nothing about revenue, commission or brokerage appears here. What is true
 * regardless of pricing is that every hostel is verified before listing and the
 * enquiry reaches whoever runs it — no agent in the middle.
 */
export function TrustSection() {
  return (
    <section className={`px-4 py-16 sm:px-6 sm:py-20 ${GROUND_LIGHT}`}>
      <div className="mx-auto max-w-6xl">
        <div className="max-w-[780px]">
          <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-primary">Why you can trust this</span>
          <h2 className="mt-4 font-display text-[clamp(32px,4.6vw,48px)] font-extrabold leading-[1.06] tracking-tight text-foreground">
            No agents.
            <br />
            Just you and the hostel.
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            Every hostel here is visited and verified before it goes live. Your enquiry reaches the person who actually
            runs it, not an agent or a call centre. And what you agree is written down, with receipts you can produce
            months later.
          </p>
        </div>

        <div className="mt-11 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-[18px] border border-border bg-card p-6">
              <Icon className="h-6 w-6 text-primary" strokeWidth={1.8} aria-hidden="true" />
              <h3 className="mt-3.5 font-display text-base font-extrabold text-foreground">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
