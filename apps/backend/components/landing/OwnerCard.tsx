import { Phone, MessageCircle } from 'lucide-react';
import { urlFor } from '@/sanity/lib/image';

export function OwnerCard({ siteSettings }: { siteSettings: any }) {
  const ownerName = siteSettings.ownerName;
  const ownerTitle = siteSettings.ownerTitle || "Owner";
  const ownerQuote = siteSettings.ownerQuote || "";
  const phone = siteSettings.phoneNumber;
  const whatsappNumber = siteSettings.whatsappNumber;
  
  const initials = ownerName
    .split(" ")
    .map((n: string) => n[0])
    .join("") || "SR";

  const ownerPhotoUrl = siteSettings.ownerPhoto
    ? urlFor(siteSettings.ownerPhoto).url()
    : null;

  const template = siteSettings.whatsappHeroTemplate || "Hi {ownerName}, I'm interested in checking availability";
  const message = template.replace("{ownerName}", ownerName).replace("{hostelName}", "");
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  return (
    <div className="bg-[#FFFDF5] rounded-2xl p-6 shadow-lg border-l-4 border-[#F07B1D]">
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#F07B1D]/20 to-[#1B2D5B]/20 flex items-center justify-center overflow-hidden border-4 border-white shadow-lg">
            {ownerPhotoUrl ? (
              <img
                src={ownerPhotoUrl}
                alt={ownerName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#1B2D5B] font-bold text-2xl">
                {initials}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1">
          <h3 className="font-semibold text-[#1B2D5B] text-lg">
            {ownerName}
          </h3>
          <p className="text-sm text-[#2C2C2A]/60 mb-1">
            {ownerTitle}
          </p>
          <p className="text-sm text-[#F07B1D] italic">
            {ownerQuote}
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-4 pt-4 border-t border-[#F07B1D]/20">
        <a
          href={`tel:${phone}`}
          className="flex items-center justify-center gap-2 flex-1 bg-[#F07B1D] text-white px-4 py-2.5 rounded-lg hover:bg-[#d96e18] transition-colors text-sm font-medium"
        >
          <Phone className="w-4 h-4" />
          <span>Call</span>
        </a>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 flex-1 bg-green-500 text-white px-4 py-2.5 rounded-lg hover:bg-green-600 transition-colors text-sm font-medium"
        >
          <MessageCircle className="w-4 h-4" />
          <span>WhatsApp</span>
        </a>
      </div>
    </div>
  );
}
