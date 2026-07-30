import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

const ROOM_TYPES = [
  {
    type: 'Single Occupancy',
    icon: '🛏️',
    desc: 'A private room for one student. Ideal for those who prefer a quiet, personal space.',
    features: ['Single bed + mattress', 'Personal wardrobe', 'Study table & chair', 'Attached / shared bathroom options', 'Personal storage shelf'],
    badge: 'Most Private',
    badgeColor: '#1e3a5f',
  },
  {
    type: 'Double Sharing',
    icon: '🛏️🛏️',
    desc: 'Shared room for two students. The most popular choice — great balance of privacy and company.',
    features: ['Two single beds + mattresses', 'Individual wardrobes', 'Two study tables', 'Shared attached bathroom', 'Common storage space'],
    badge: 'Most Popular',
    badgeColor: '#f59e0b',
  },
  {
    type: 'Triple Sharing',
    icon: '🛋️',
    desc: 'Shared room for three students. Budget-friendly with shared facilities.',
    features: ['Three single beds', 'Individual wardrobes', 'Study desks for each', 'Shared common bathroom', 'Excellent for budget stays'],
    badge: 'Best Value',
    badgeColor: '#22c55e',
  },
];

export function RoomsPage() {
  useEffect(() => {
    document.title = 'Room Types & Pricing | StayO, Hyderabad';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Explore room types at StayO — single, double sharing, and triple sharing rooms. Affordable pricing with all amenities included.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://www.stayo.app/rooms');
  }, []);

  return (
    <PublicLayout title="Room Types" subtitle="Choose the accommodation that fits your budget and preference.">
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid gap-7" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {ROOM_TYPES.map(room => (
            <article key={room.type} className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 relative">
              <span
                className="absolute top-5 right-5 text-white text-xs font-bold px-3 py-1 rounded-full"
                style={{ background: room.badgeColor }}
              >
                {room.badge}
              </span>
              <div className="text-4xl mb-5">{room.icon}</div>
              <h2 className="font-extrabold text-slate-800 text-xl mb-3">{room.type}</h2>
              <p className="text-slate-500 text-sm leading-relaxed mb-5">{room.desc}</p>
              <ul className="space-y-2.5 list-none p-0">
                {room.features.map(feat => (
                  <li key={feat} className="flex items-center gap-2.5 text-sm text-slate-600">
                    <span className="font-bold" style={{ color: '#22c55e' }}>✓</span>
                    {feat}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-14 bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
          <h2 className="font-bold text-slate-800 text-xl mb-3">Pricing & Availability</h2>
          <p className="text-slate-500 mb-6 text-sm">
            Fees vary based on room type and academic period. Contact us for current pricing, availability, and admission process details.
          </p>
          <Link
            to="/contact"
            className="no-underline font-bold text-sm px-9 py-3.5 rounded-xl hover:opacity-90 transition-opacity"
            style={{ background: '#1e3a5f', color: '#fff' }}
          >
            Ask About Pricing
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
