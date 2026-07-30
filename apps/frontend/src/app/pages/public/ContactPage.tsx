import { useEffect, useState } from 'react';
import { PublicLayout } from './PublicLayout';

export function ContactPage() {
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    document.title = 'Contact Us | StayO, Hyderabad';
    const desc = document.querySelector('meta[name="description"]');
    desc?.setAttribute('content', 'Contact StayO for admission enquiries, fee details, room availability, and hostel visits. We\'re here to help.');
    const canonical = document.querySelector('link[rel="canonical"]');
    canonical?.setAttribute('href', 'https://www.stayo.app/contact');
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <PublicLayout title="Contact Us" subtitle="We'd love to hear from you.">
      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="grid gap-7" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>

          {/* Contact info */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
              <h2 className="font-extrabold text-slate-800 text-lg mb-6">Get In Touch</h2>
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#1e3a5f' }}>📞 Phone</p>
                  <a href="tel:+917901070333" className="no-underline font-semibold text-slate-700 text-base hover:text-slate-900">
                    +91 79010 70333
                  </a>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#1e3a5f' }}>📧 Email</p>
                  <a href="mailto:support@stayo.app" className="no-underline text-slate-600 text-sm hover:text-slate-900">
                    support@stayo.app
                  </a>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#1e3a5f' }}>📍 Address</p>
                  <address className="not-italic text-slate-600 text-sm leading-7">
                    StayO<br />
                    Hyderabad, Telangana<br />
                    India
                  </address>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: '#1e3a5f' }}>🕐 Office Hours</p>
                  <p className="text-slate-600 text-sm leading-7">
                    Monday – Saturday: 9:00 AM – 7:00 PM<br />
                    Sunday: 10:00 AM – 2:00 PM
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl p-6 text-white" style={{ background: '#1e3a5f' }}>
              <p className="font-bold mb-2">🏠 Schedule a Visit</p>
              <p className="text-slate-300 text-sm leading-relaxed">
                We encourage prospective students and parents to visit the hostel in person before admission.
                Call us to schedule a convenient time.
              </p>
            </div>
          </div>

          {/* Enquiry form */}
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
            <h2 className="font-extrabold text-slate-800 text-lg mb-6">Send an Enquiry</h2>

            {submitted ? (
              <div className="text-center py-12">
                <div className="text-5xl mb-4">✅</div>
                <p className="font-bold text-slate-800 mb-2">Enquiry Sent!</p>
                <p className="text-slate-500 text-sm">We'll contact you within 24 hours.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="contact-name" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Full Name *
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    required
                    placeholder="Your full name"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:border-transparent transition"
                    style={{ focusRingColor: '#1e3a5f' } as React.CSSProperties}
                  />
                </div>
                <div>
                  <label htmlFor="contact-phone" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Phone Number *
                  </label>
                  <input
                    id="contact-phone"
                    type="tel"
                    required
                    placeholder="+91 XXXXX XXXXX"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 transition"
                  />
                </div>
                <div>
                  <label htmlFor="contact-email" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Email (optional)
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    placeholder="your@email.com"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 transition"
                  />
                </div>
                <div>
                  <label htmlFor="contact-room" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Room Preference
                  </label>
                  <select
                    id="contact-room"
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 transition bg-white text-slate-600"
                  >
                    <option value="">Select preference</option>
                    <option value="single">Single Occupancy</option>
                    <option value="double">Double Sharing</option>
                    <option value="triple">Triple Sharing</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="contact-message" className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Message
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    placeholder="Any questions or specific requirements..."
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 transition resize-y"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-3.5 rounded-xl font-bold text-sm transition-opacity hover:opacity-90"
                  style={{ background: '#1e3a5f', color: '#fff' }}
                >
                  Send Enquiry
                </button>
              </form>
            )}
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
