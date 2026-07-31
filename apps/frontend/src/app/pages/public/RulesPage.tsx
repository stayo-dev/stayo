import { useEffect } from 'react';
import { PublicLayout } from './PublicLayout';

const RULES = [
  {
    category: 'Entry & Exit',
    icon: '🚪',
    items: [
      'Entry and exit timings are strictly enforced. Late entry requires prior warden approval.',
      'All residents must sign the entry/exit register when leaving or returning.',
      'Residents must return by the specified curfew time unless prior permission is granted.',
      'Parents or guardians visiting must register at reception with valid ID.',
    ],
  },
  {
    category: 'Room & Cleanliness',
    icon: '🧹',
    items: [
      'Rooms must be kept clean and tidy at all times. Periodic room inspections will be conducted.',
      'Garbage must be disposed of in designated bins only.',
      'Clothes may only be dried in designated drying areas.',
      'Cooking inside rooms is strictly prohibited — use the dining hall.',
      'Pets are not allowed inside the hostel premises.',
    ],
  },
  {
    category: 'Behaviour & Discipline',
    icon: '🤝',
    items: [
      'Residents must maintain respectful conduct towards staff, wardens, and fellow students.',
      'Ragging in any form is a serious offence and will result in immediate expulsion.',
      'Noise must be kept minimal during study hours (8:00 PM – 10:00 PM) and after lights out.',
      'Consumption or possession of alcohol, tobacco, or drugs is strictly prohibited.',
      'Gambling or any unlawful activity on premises is prohibited.',
    ],
  },
  {
    category: 'Visitors',
    icon: '👥',
    items: [
      'Visitors are allowed only in designated common areas during permitted visiting hours.',
      'Overnight guests are strictly not allowed.',
      'Female visitors are not permitted inside the residential wing under any circumstances.',
    ],
  },
  {
    category: 'Property & Safety',
    icon: '🔒',
    items: [
      'Residents are responsible for the care and maintenance of hostel property assigned to them.',
      'Any damage to hostel property must be reported to the warden and will be recovered from the resident.',
      'Use of personal electrical appliances requires prior approval.',
      'Fire safety equipment must not be tampered with.',
    ],
  },
  {
    category: 'Fees & Administration',
    icon: '💳',
    items: [
      'Monthly fees must be paid on or before the due date. Late payments attract a penalty.',
      'Receipts must be collected and retained for all payments made.',
      'Room changes or special requests must be submitted in writing to the warden.',
      'A minimum of one month\'s notice is required before vacating the hostel.',
    ],
  },
];

export function RulesPage() {
  useEffect(() => {
    document.title = 'Hostel Rules & Regulations | Stayo';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Read the hostel rules and regulations at Stayo. Rules on entry timings, cleanliness, behaviour, visitors, and fees.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://yourstayo.com/rules');
  }, []);

  return (
    <PublicLayout title="Rules & Regulations" subtitle="Our guidelines ensure a safe, disciplined, and respectful environment for all.">
      <section className="max-w-3xl mx-auto px-6 py-16">

        {/* Warning banner */}
        <div className="flex gap-4 items-start bg-amber-50 border border-amber-200 rounded-xl p-5 mb-10">
          <span className="text-xl">⚠️</span>
          <p className="text-amber-800 text-sm leading-relaxed m-0">
            All residents are required to read, understand, and comply with these rules.
            Serious violations may result in disciplinary action including expulsion without refund.
          </p>
        </div>

        <div className="space-y-6">
          {RULES.map(section => (
            <article key={section.category} className="bg-white rounded-2xl p-7 shadow-sm border border-slate-100">
              <h2 className="flex items-center gap-3 font-extrabold text-slate-800 text-base mb-5">
                <span className="text-2xl">{section.icon}</span>
                {section.category}
              </h2>
              <ol className="space-y-3 pl-5 m-0">
                {section.items.map((rule, i) => (
                  <li key={i} className="text-slate-600 text-sm leading-relaxed">
                    {rule}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>

        <p className="mt-10 text-center text-slate-400 text-xs">
          Last updated: May 2026 · For queries, contact the hostel office.
        </p>
      </section>
    </PublicLayout>
  );
}
