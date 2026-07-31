import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

export function AboutPage() {
  useEffect(() => {
    document.title = 'About Us | Stayo';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'About Stayo — a hostel management platform and verified marketplace, developed and operated by Trishul Solutions.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://yourstayo.com/about');
  }, []);

  return (
    <PublicLayout title="About Stayo" subtitle="One platform for the entire stay lifecycle.">
      <section className="max-w-3xl mx-auto px-6 py-16 text-slate-600 leading-relaxed">

        <h2 className="text-2xl font-bold text-slate-800 mb-4">What Stayo Is</h2>
        <p className="mb-6">
          Stayo is a hostel and PG management platform — a verified marketplace where students discover
          safe, transparently-priced homes, and a complete operations system where owners run them:
          enquiries, onboarding, digital agreements, rent collection and reporting, all on one rail from
          move-in to move-out.
        </p>

        <h2 className="text-2xl font-bold text-slate-800 mb-4 mt-12">Our Mission</h2>
        <p className="mb-6">
          We believe finding a place to stay — and running one — should be effortless and trustworthy.
          Stayo brings transparency to students and automation to owners, replacing broker games and
          manual paperwork with verified listings, clear pricing, and software that does the busywork.
        </p>

        <h2 className="text-2xl font-bold text-slate-800 mb-6 mt-12">Why People Choose Stayo</h2>
        <ul className="space-y-3 list-none p-0">
          {[
            'Manually verified hostels and verified owners',
            'Transparent pricing — rent, deposit and inclusions upfront',
            'Real photos and secure, digital documents',
            'Automated rent collection with WhatsApp reminders',
            'Paperless KYC and e-signed agreements',
            'Occupancy, dues and revenue insights for owners',
            'No instant booking — owners review every request',
          ].map(item => (
            <li key={item} className="flex items-start gap-3">
              <span className="font-bold text-lg mt-0.5" style={{ color: '#f59e0b' }}>✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-4 mt-14">
          <Link
            to="/contact"
            className="no-underline font-bold text-sm px-7 py-3 rounded-lg hover:opacity-90 transition-opacity"
            style={{ background: '#1e3a5f', color: '#fff' }}
          >
            Contact Us
          </Link>
          <Link
            to="/company"
            className="no-underline font-semibold text-sm px-7 py-3 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            style={{ color: '#1e3a5f' }}
          >
            About Trishul Solutions
          </Link>
        </div>

        {/* Company attribution */}
        <p className="mt-14 pt-8 border-t border-slate-200 text-sm text-slate-500">
          Stayo is proudly developed and operated by{' '}
          <Link to="/company" className="font-semibold text-slate-700 hover:text-slate-900 no-underline">
            Trishul Solutions
          </Link>
          .
        </p>
      </section>
    </PublicLayout>
  );
}
