'use client';

import Link from 'next/link';

export function Navbar({ hostelName }: { hostelName: string }) {
  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <nav className="bg-white shadow-md sticky top-0 z-[100] h-[56px] md:h-auto flex items-center">
      <div className="max-w-7xl mx-auto px-4 py-1.5 md:py-4 w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/hostel_icon.jpeg"
              alt={`${hostelName} Logo`}
              className="w-8 h-8 xs:w-10 xs:h-10 md:w-12 md:h-12 object-contain rounded-md"
            />
            <div>
              <h1 className="text-xs xs:text-sm sm:text-base md:text-xl font-bold text-[#1B2D5B] whitespace-nowrap" style={{ fontFamily: 'var(--font-display)' }}>
                {hostelName}
              </h1>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <button onClick={() => scrollToSection('home')} className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors">
              Home
            </button>
            <button onClick={() => scrollToSection('facilities')} className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors">
              Facilities
            </button>
            <button onClick={() => scrollToSection('rooms')} className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors">
              Rooms
            </button>
            <button onClick={() => scrollToSection('location')} className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors">
              Location
            </button>
            <button onClick={() => scrollToSection('contact')} className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors">
              Contact
            </button>
            <Link
              href="/login"
              className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors border border-[#F07B1D] px-4 py-2 rounded-lg"
            >
              Login
            </Link>
            <button
              onClick={() => scrollToSection('contact')}
              className="bg-[#F07B1D] text-white px-6 py-2 rounded-lg hover:bg-[#d96e18] transition-colors relative"
            >
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-600 rounded-full animate-pulse" />
              Enquire Now
            </button>
          </div>

          <div className="md:hidden flex items-center gap-2">
            <Link
              href="/login"
              className="text-[#2C2C2A] hover:text-[#F07B1D] transition-colors border border-[#F07B1D] px-3 py-1.5 rounded-lg text-sm font-semibold"
            >
              Login
            </Link>
            <button
              onClick={() => scrollToSection('contact')}
              className="bg-[#F07B1D] text-white px-3 py-1.5 rounded-lg hover:bg-[#d96e18] transition-colors text-sm font-medium relative"
            >
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 rounded-full animate-pulse" />
              Enquire Now
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
