import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

const FACILITIES = [
  { icon: '🛏️', title: 'Furnished Rooms', desc: 'All rooms come equipped with beds, mattresses, wardrobes, study tables, and chairs. Clean, organised living spaces maintained regularly.' },
  { icon: '🍽️', title: 'Dining & Meals', desc: 'Three nutritious home-cooked meals daily — breakfast, lunch, and dinner — served in our clean dining hall. Special dietary needs accommodated on request.' },
  { icon: '🔒', title: '24/7 Security', desc: 'Trained security guards round the clock, biometric access control at main entry, and CCTV surveillance covering all common areas and corridors.' },
  { icon: '📶', title: 'High-Speed Wi-Fi', desc: 'Reliable broadband internet connectivity available throughout the hostel including rooms and common areas, ideal for online classes and research.' },
  { icon: '📚', title: 'Study Room', desc: 'A dedicated quiet reading and study room with individual desks, good lighting, and a distraction-free environment for exam preparation.' },
  { icon: '👕', title: 'Laundry Facility', desc: 'Washing machine access available for all residents at scheduled times. Provisions for drying clothes within the premises.' },
  { icon: '🚿', title: 'Hot Water Supply', desc: 'Solar-heated hot water available every morning. Backup geyser systems ensure uninterrupted supply throughout the day.' },
  { icon: '⚡', title: 'Power Backup', desc: 'UPS and generator backup to ensure uninterrupted power supply for lights, fans, and essential appliances during outages.' },
  { icon: '🧹', title: 'Housekeeping', desc: 'Regular room cleaning and common area maintenance carried out by dedicated housekeeping staff to ensure hygienic living conditions.' },
  { icon: '🏥', title: 'Medical Assistance', desc: 'First-aid facility on campus. Warden staff trained to assist in medical emergencies and coordinate with nearby hospitals if needed.' },
  { icon: '📦', title: 'Storage Space', desc: 'Additional storage facilities available for residents who need to keep luggage or belongings securely during vacation periods.' },
  { icon: '🌐', title: 'Visitor Management', desc: 'Structured visitor entry protocol to maintain security and privacy for all residents. Visitors allowed only in designated areas and permitted hours.' },
];

export function FacilitiesPage() {
  useEffect(() => {
    document.title = 'Facilities | Stayo';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Explore all facilities at Stayo — furnished rooms, meals, 24/7 security, Wi-Fi, study room, laundry, and more.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://yourstayo.com/facilities');
  }, []);

  return (
    <PublicLayout title="Our Facilities" subtitle="Everything you need for a comfortable stay.">
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          {FACILITIES.map(f => (
            <article key={f.title} className="bg-white rounded-2xl p-7 shadow-sm border border-slate-100">
              <div className="text-4xl mb-4">{f.icon}</div>
              <h2 className="font-bold text-slate-800 text-base mb-3">{f.title}</h2>
              <p className="text-slate-500 text-sm leading-relaxed">{f.desc}</p>
            </article>
          ))}
        </div>

        <div className="mt-16 text-center">
          <p className="text-slate-500 mb-5">Interested in staying with us?</p>
          <Link
            to="/contact"
            className="no-underline font-bold text-sm px-9 py-3.5 rounded-xl hover:opacity-90 transition-opacity"
            style={{ background: '#1e3a5f', color: '#fff' }}
          >
            Enquire About Availability
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
