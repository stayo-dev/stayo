'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Phone, Mail, MessageCircle, Send } from 'lucide-react';
import { admissionsPublicService } from '@features/admissions/api';
import { ScrollReveal, StaggerReveal, StaggerItem } from './ScrollReveal';
import type { LandingAvailability } from './landingTypes';
import type { HostelProfileContent } from '@lib/sanity/landingContent';
import { fallbackLandingContent } from '@lib/sanity/client';

export function EnquiryForm({
  availability,
  hostelProfile,
  visitSlug,
}: {
  availability?: LandingAvailability;
  hostelProfile?: HostelProfileContent;
  visitSlug?: string;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    moveInMonth: 'This month',
    message: '',
  });
  
  const profile = { ...fallbackLandingContent.hostelProfile, ...hostelProfile };
  const phone = profile.phone;
  const whatsappNumber = profile.whatsappNumber;
  const whatsappBaseUrl = `https://api.whatsapp.com/send?phone=${whatsappNumber}`;

  const openWhatsApp = () => {
    const template = profile.whatsappEnquiryTemplate || "Hi! I'm interested in {hostelName}.\n\nName: {name}\nPhone: {phone}\nPreferred Move-in: {moveInMonth}\n\nMessage: {message}";
    const formattedMessage = template
      .replace("{hostelName}", profile.name || "")
      .replace("{name}", formData.name)
      .replace("{phone}", formData.phone)
      .replace("{moveInMonth}", formData.moveInMonth)
      .replace("{message}", formData.message);

    const whatsappMessage = encodeURIComponent(formattedMessage);
    window.open(`${whatsappBaseUrl}&text=${whatsappMessage}`, '_blank');
  };

  const submitLead = useMutation({
    mutationFn: () =>
      admissionsPublicService.createLead(visitSlug || '', {
        student_name: formData.name,
        student_phone: formData.phone,
        student_email: '', // Default to empty string since field is removed
        source: 'DIRECT',
        notes: [
          `Preferred move-in: ${formData.moveInMonth}`,
          formData.message ? `Message: ${formData.message}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      }),
    onSuccess: () => setSubmitted(true),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(false);
    if (visitSlug) {
      submitLead.mutate();
      return;
    }
    openWhatsApp();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <section id="contact" className="py-10 md:py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4">
        <ScrollReveal>
          <h2
            className="text-3xl md:text-4xl text-center text-[#1B2D5B] mb-4 font-bold"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Check Availability & Reserve Your Bed
          </h2>
        </ScrollReveal>
        <ScrollReveal delay={0.2}>
          <div className="text-center mb-12 max-w-2xl mx-auto">
            <p className="text-[#2C2C2A] mb-3 font-medium text-sm md:text-base">
              Have questions? We're here to help. Contact us today!
            </p>
            {availability?.hasLiveAvailability ? (
              <div className="inline-flex items-center gap-2 bg-[#FBB040]/20 border border-[#FBB040] px-4 py-2 rounded-full text-xs md:text-sm font-semibold text-[#2C2C2A]">
                <span className="w-2 h-2 bg-[#FBB040] rounded-full" />
                {availability.bedsAvailable} beds open for {availability.intakeMonth} intake — responding within 2 hours
              </div>
            ) : (
              <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-200 px-4 py-2 rounded-full text-xs md:text-sm font-semibold text-blue-700">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                Admissions open for {availability?.intakeMonth || 'current'} intake — responding within 2 hours
              </div>
            )}
          </div>
        </ScrollReveal>

        <StaggerReveal>
          <div className="grid md:grid-cols-2 gap-8">
            {/* Form Column first on mobile & desktop */}
            <StaggerItem>
              <div className="bg-[#FFFDF5] p-6 md:p-8 rounded-xl shadow-lg border border-[#F07B1D]/15">
                <h3 className="text-xl font-bold text-[#1B2D5B] mb-6">Send us a message</h3>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label htmlFor="name" className="block text-sm font-semibold text-[#2C2C2A] mb-2">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      value={formData.name}
                      onChange={handleChange}
                      className="w-full px-4 py-3 bg-white border border-[#F07B1D]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F07B1D] text-[#2C2C2A] font-medium"
                      placeholder="Enter your name"
                    />
                  </div>

                  <div>
                    <label htmlFor="phone" className="block text-sm font-semibold text-[#2C2C2A] mb-2">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="w-full px-4 py-3 bg-white border border-[#F07B1D]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F07B1D] text-[#2C2C2A] font-medium"
                      placeholder="Enter your phone number"
                    />
                  </div>

                  <div>
                    <label htmlFor="moveInMonth" className="block text-sm font-semibold text-[#2C2C2A] mb-2">
                      Preferred Move-in Month *
                    </label>
                    <select
                      id="moveInMonth"
                      name="moveInMonth"
                      required
                      value={formData.moveInMonth}
                      onChange={handleChange}
                      className="w-full px-4 py-3 bg-white border border-[#F07B1D]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F07B1D] text-[#2C2C2A] font-medium"
                    >
                      <option value="This month">This month ({availability?.intakeMonth || 'Current'})</option>
                      <option value="Next month">Next month</option>
                      <option value="After 2 months">After 2 months</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="message" className="block text-sm font-semibold text-[#2C2C2A] mb-2">
                      Message
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      rows={4}
                      value={formData.message}
                      onChange={handleChange}
                      className="w-full px-4 py-3 bg-white border border-[#F07B1D]/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F07B1D] text-[#2C2C2A] resize-none font-medium"
                      placeholder="Any specific questions or requirements?"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitLead.isPending}
                    className="w-full bg-[#F07B1D] text-white py-4 rounded-lg hover:bg-[#d96e18] transition-colors font-bold flex items-center justify-center gap-2 disabled:opacity-70 shadow-md"
                  >
                    <Send className="w-5 h-5" />
                    <span>{submitLead.isPending ? 'Sending enquiry...' : 'Send Enquiry'}</span>
                  </button>

                  {submitted && (
                    <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-700 mt-2">
                      Enquiry saved. The hostel owner can now follow up from HMS admissions.
                    </div>
                  )}
                  {submitLead.isError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 mt-2">
                      Could not save enquiry.
                      <button type="button" onClick={openWhatsApp} className="ml-2 underline font-bold">
                        Contact on WhatsApp
                      </button>
                    </div>
                  )}
                </form>
              </div>
            </StaggerItem>

            {/* Info Column second on mobile & desktop */}
            <StaggerItem>
              <div className="space-y-6">
                <div className="bg-[#FFFDF5] p-6 md:p-8 rounded-xl shadow-lg border border-[#F07B1D]/10">
                  <h3 className="text-xl font-bold text-[#1B2D5B] mb-6">Contact Information</h3>

                  <div className="space-y-4">
                    <a
                      href={`tel:${phone}`}
                      className="flex items-center gap-4 p-4 bg-white rounded-lg hover:shadow-md transition-shadow group border border-slate-100"
                    >
                      <div className="w-12 h-12 bg-[#F07B1D] rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Phone className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-xs text-[#2C2C2A]/70 font-semibold">Phone</div>
                        <div className="font-bold text-[#1B2D5B]">{phone}</div>
                      </div>
                    </a>

                    <a
                      href={whatsappBaseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-4 p-4 bg-white rounded-lg hover:shadow-md transition-shadow group border border-slate-100"
                    >
                      <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                        <MessageCircle className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-xs text-[#2C2C2A]/70 font-semibold">WhatsApp</div>
                        <div className="font-bold text-[#1B2D5B]">Chat with us</div>
                      </div>
                    </a>

                    <div className="flex items-center gap-4 p-4 bg-white rounded-lg border border-slate-100">
                      <div className="w-12 h-12 bg-[#1B2D5B] rounded-full flex items-center justify-center">
                        <Mail className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <div className="text-xs text-[#2C2C2A]/70 font-semibold">{profile.email ? 'Email' : 'Hostel'}</div>
                        <div className="font-bold text-[#1B2D5B]">{profile.email || profile.name}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-[#F07B1D] text-white p-6 rounded-xl shadow-md border border-[#F07B1D]">
                  <p className="text-center font-bold text-sm md:text-base">
                    Available 24/7 for enquiries and bookings
                  </p>
                </div>

                <div className="bg-white rounded-xl p-6 shadow-lg border-l-4 border-[#F07B1D] relative border border-slate-200">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#F07B1D]/20 to-[#1B2D5B]/20 flex items-center justify-center overflow-hidden border-2 border-white shadow-md flex-shrink-0">
                      {profile.ownerPhoto?.url ? (
                        <img src={profile.ownerPhoto.url} alt={profile.ownerPhoto.alt || profile.ownerName || 'Hostel owner'} className="h-full w-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#1B2D5B] font-bold text-lg">
                          {(profile.ownerName || 'Srinivasa Rao').split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="bg-[#FFFDF5]/40 border border-[#F07B1D]/20 rounded-lg p-3 shadow-sm relative">
                        <div className="absolute -left-2 top-4 w-0 h-0 border-t-8 border-t-transparent border-b-8 border-b-transparent border-r-8 border-r-[#FFFDF5] border-r-opacity-100" style={{ borderRightColor: '#FFFDF5' }} />
                        <p className="text-[#1B2D5B] italic text-sm font-semibold">
                          &quot;{profile.ownerMessage || 'I personally respond to every enquiry.'}&quot;
                        </p>
                      </div>
                      <p className="text-xs text-[#2C2C2A]/70 mt-2 ml-3 font-bold">
                        — {profile.ownerName || 'Srinivasa Rao'}, Owner
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </StaggerItem>
          </div>
        </StaggerReveal>
      </div>
    </section>
  );
}
