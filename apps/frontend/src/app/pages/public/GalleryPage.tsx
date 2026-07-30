import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicLayout } from './PublicLayout';

const HIGHLIGHTS = [
  { label: 'Furnished rooms', emoji: '🛏️' },
  { label: 'Morning & evening meals', emoji: '🍽️' },
  { label: '24/7 security post', emoji: '🔒' },
  { label: 'Study spaces', emoji: '📚' },
  { label: 'Common lounge', emoji: '🛋️' },
  { label: 'Green courtyard', emoji: '🌿' },
  { label: 'Clean bathrooms', emoji: '🚿' },
  { label: 'Parking for bikes', emoji: '🏍️' },
  { label: 'Dining hall', emoji: '🏠' },
  { label: 'Reading room', emoji: '🪑' },
  { label: 'Recreation area', emoji: '🎯' },
  { label: 'Reception & warden office', emoji: '🏢' },
];

export function GalleryPage() {
  useEffect(() => {
    document.title = 'Gallery | StayO, Hyderabad';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'See photos of StayO — rooms, dining hall, study areas, common spaces, and more.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://www.stayo.app/gallery');
  }, []);

  return (
    <PublicLayout title="Gallery" subtitle="A look inside StayO.">
      <section className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {HIGHLIGHTS.map((h, i) => (
            <div
              key={h.label}
              className="rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center gap-3"
              style={{
                aspectRatio: '4/3',
                background: `hsl(${210 + i * 12}, 25%, ${88 - i * 1.5}%)`,
              }}
            >
              <span className="text-5xl">{h.emoji}</span>
              <span className="font-semibold text-slate-700 text-sm">{h.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-14 bg-slate-50 rounded-2xl p-8 text-center border border-slate-100">
          <p className="text-slate-500 mb-5 text-sm">Want to see the hostel in person? Schedule a visit.</p>
          <Link
            to="/contact"
            className="no-underline font-bold text-sm px-8 py-3 rounded-xl hover:opacity-90 transition-opacity"
            style={{ background: '#1e3a5f', color: '#fff' }}
          >
            Book a Visit
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
