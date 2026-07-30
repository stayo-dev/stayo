import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

export function AboutPage() {
  useEffect(() => {
    document.title = 'About Us | StayO, Hyderabad';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Learn about StayO — our story, mission, and commitment to safe, affordable student accommodation in Hyderabad.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://www.stayo.app/about');
  }, []);

  return (
    <PublicLayout title="About Us" subtitle="Our story, our mission.">
      <section className="max-w-3xl mx-auto px-6 py-16 text-slate-600 leading-relaxed">

        <h2 className="text-2xl font-bold text-slate-800 mb-4">Who We Are</h2>
        <p className="mb-6">
          StayO has been a home away from home for students pursuing their education
          in Hyderabad. Founded with a clear mission — to provide safe, clean, and affordable student
          accommodation — we have consistently prioritized the wellbeing, comfort, and academic success
          of our residents.
        </p>

        <h2 className="text-2xl font-bold text-slate-800 mb-4 mt-12">Our Mission</h2>
        <p className="mb-6">
          We believe every student deserves a secure environment that supports their studies and personal
          growth. Our hostel provides a structured, disciplined, and nurturing atmosphere where students
          can thrive — with home-cooked meals, round-the-clock security, and dedicated study spaces.
        </p>

        <h2 className="text-2xl font-bold text-slate-800 mb-6 mt-12">Why Students Choose Us</h2>
        <ul className="space-y-3 list-none p-0">
          {[
            'Transparent and affordable fee structure',
            'Home-cooked nutritious meals, three times daily',
            'Strict security protocols — biometric entry and CCTV',
            'Quiet study environment with dedicated spaces',
            'Regular room cleaning and maintenance',
            'Close proximity to major colleges and institutions',
            'Experienced and responsive warden staff',
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
            Enquire Now
          </Link>
          <Link
            to="/facilities"
            className="no-underline font-semibold text-sm px-7 py-3 rounded-lg bg-slate-100 hover:bg-slate-200 transition-colors"
            style={{ color: '#1e3a5f' }}
          >
            See Facilities
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
