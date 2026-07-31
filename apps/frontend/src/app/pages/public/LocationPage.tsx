import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

export function LocationPage() {
  useEffect(() => {
    document.title = 'Reach Us | Stayo';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Stayo is an online platform operated by Trishul Solutions. Reach us by phone, email or WhatsApp.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://yourstayo.com/location');
  }, []);

  return (
    <PublicLayout title="Reach Us" subtitle="We operate online across India.">
      <section className="max-w-2xl mx-auto px-6 py-16">
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 text-slate-600 leading-relaxed">
          <h2 className="font-extrabold text-slate-800 text-lg mb-4">An online-first platform</h2>
          <p className="mb-6">
            Stayo is a fully online hostel & PG platform operated by <strong>Trishul Solutions</strong>.
            There is no walk-in office — everything, from discovering a stay to onboarding and payments,
            happens digitally. The quickest way to reach us is by phone, email or WhatsApp.
          </p>

          <div className="space-y-3 text-sm">
            <a href="tel:+917675080090" className="block font-semibold text-slate-700 hover:text-slate-900 no-underline">
              📞 +91 76750 80090
            </a>
            <a href="mailto:contact@yourstayo.com" className="block text-slate-600 hover:text-slate-900 no-underline">
              📧 contact@yourstayo.com
            </a>
            <a
              href="https://wa.me/917675080090"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-slate-600 hover:text-slate-900 no-underline"
            >
              💬 WhatsApp us
            </a>
          </div>

          <div className="flex flex-wrap gap-4 mt-10">
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
        </div>
      </section>
    </PublicLayout>
  );
}
