import { useEffect } from 'react';
import { PublicLayout } from './PublicLayout';

const TRANSPORT = [
  { icon: '🚌', mode: 'By TSRTC Bus', detail: 'Multiple bus routes pass nearby. Ask the conductor for the stop closest to our address.' },
  { icon: '🚇', mode: 'By Metro', detail: 'Hyderabad Metro accessible. Take an auto or cab from the nearest metro station.' },
  { icon: '🚕', mode: 'By Auto / Cab', detail: 'Autos and app cabs (Ola/Uber) readily available from all major points in the city.' },
  { icon: '🚂', mode: 'From Railway Station', detail: 'Approximately 15–20 minutes by auto from Secunderabad or Kachiguda stations.' },
];

export function LocationPage() {
  useEffect(() => {
    document.title = 'Location & Directions | StayO, Hyderabad';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Find StayO in Hyderabad. Get directions, nearby landmarks, and transport options.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://www.stayo.app/location');
  }, []);

  return (
    <PublicLayout title="Location & Directions" subtitle="Find us easily in Hyderabad.">
      <section className="max-w-4xl mx-auto px-6 py-16 space-y-8">

        {/* Address card */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
          <h2 className="font-extrabold text-slate-800 text-lg mb-5">📍 Our Address</h2>
          <address className="not-italic text-slate-600 leading-8 text-base">
            <strong>StayO</strong><br />
            [Registered address — TBD]<br />
            Near Sreenidhi Institute of Science and Technology (SNIST)
          </address>
          <a
            href="https://www.google.com/maps/dir/?api=1&destination=Sri+Adithya+Boys+Hostel+Yamnampet&destination_place_id=ChIJW1hB1g13yzsRscG4r7mVPt4"
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline inline-block mt-6 font-bold text-sm px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity"
            style={{ background: '#1e3a5f', color: '#fff' }}
          >
            Open in Google Maps
          </a>
        </div>

        {/* Map placeholder */}
        <div
          className="rounded-2xl border border-slate-100 flex flex-col items-center justify-center gap-3 text-slate-400"
          style={{ height: 300, background: 'linear-gradient(135deg, #e2e8f0, #cbd5e1)' }}
        >
          <span className="text-5xl">🗺️</span>
          <p className="font-semibold m-0">Yamnampet, Secunderabad</p>
          <p className="text-sm m-0">Near SNIST · 501301</p>
        </div>

        {/* Nearby landmarks */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
          <h2 className="font-bold text-slate-800 text-lg mb-5">🏫 Nearby Colleges & Landmarks</h2>
          <ul className="space-y-3 list-none p-0">
            {[
              'Sreenidhi Institute of Science and Technology (SNIST) — ~0.5 km',
              'Yamnampet Junction — ~1 km',
              'Keesara / Ghatkesar — ~3 km',
              'Uppal — ~8 km',
              'Secunderabad Railway Station — ~20 km',
              'Hyderabad Airport — ~35 km',
            ].map(item => (
              <li key={item} className="flex gap-3 text-sm text-slate-600 items-center">
                <span className="font-bold" style={{ color: '#1e3a5f' }}>→</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Transport options */}
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
          <h2 className="font-bold text-slate-800 text-lg mb-6">🚌 How to Reach Us</h2>
          <div className="space-y-5">
            {TRANSPORT.map(t => (
              <div key={t.mode} className="flex gap-4 items-start">
                <span className="text-2xl">{t.icon}</span>
                <div>
                  <p className="font-bold text-slate-800 text-sm mb-1">{t.mode}</p>
                  <p className="text-slate-500 text-sm leading-relaxed">{t.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
