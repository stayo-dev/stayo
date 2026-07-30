import { Phone, MapPin, MessageCircle } from 'lucide-react';

export function TopBar({
  siteSettings,
  shortLocation,
}: {
  siteSettings: {
    phoneNumber: string;
    whatsappNumber: string;
    ownerName: string;
    whatsappHeroTemplate?: string;
  };
  shortLocation?: string;
}) {
  const phone = siteSettings.phoneNumber;
  const whatsappNumber = siteSettings.whatsappNumber;
  const ownerName = siteSettings.ownerName;
  const location = shortLocation || "Hostel Location";

  const template = siteSettings.whatsappHeroTemplate || "Hi {ownerName}, I'm interested in checking availability";
  const message = template.replace("{ownerName}", ownerName).replace("{hostelName}", "");
  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;

  return (
    <div className="bg-[#1B2D5B] text-white h-[44px] md:h-auto flex items-center px-4 py-1">
      <div className="max-w-7xl mx-auto flex w-full items-center justify-between gap-2 text-xs md:text-sm">
        <div className="flex items-center gap-3 md:gap-6">
          <a href={`tel:${phone}`} className="flex items-center gap-1 hover:opacity-80 transition-opacity">
            <Phone className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span>{phone}</span>
          </a>
          <div className="hidden sm:flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4" />
            <span className="truncate max-w-[120px] sm:max-w-none">{location}</span>
          </div>
        </div>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 hover:opacity-80 transition-opacity whitespace-nowrap bg-[#F07B1D] px-2.5 py-1 rounded text-white font-semibold text-[10px] md:text-xs"
        >
          <MessageCircle className="w-3 h-3 md:w-3.5 md:h-3.5" />
          <span>WhatsApp Us</span>
        </a>
      </div>
    </div>
  );
}
