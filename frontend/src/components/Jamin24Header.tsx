import React from "react";

interface Jamin24HeaderProps {
  onToggleTimeline?: () => void;
  showTimelineToggle?: boolean;
}

export const Jamin24Header: React.FC<Jamin24HeaderProps> = ({
  onToggleTimeline,
  showTimelineToggle = true,
}) => {
  return (
    <header className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        
        {/* LOGO */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-12 h-12 rounded-full bg-[#0D473B] text-white shadow-md border-2 border-amber-400">
            {/* Compass Symbol */}
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" stroke="#EAB308" strokeWidth="1.5" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#EAB308" stroke="#0D473B" strokeWidth="1" />
            </svg>
          </div>
          <div>
            <span className="text-2xl font-black tracking-tight text-[#0D473B] uppercase font-sans">
              Jamin<span className="text-amber-500">24</span>
            </span>
            <span className="block text-[10px] uppercase font-bold tracking-widest text-slate-500 -mt-1">
              AI Video HUB
            </span>
          </div>
        </div>

        {/* NAVIGATION LINKS */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-semibold text-slate-700">
          <a href="#" className="flex items-center gap-1.5 hover:text-[#0D473B] transition">
            <span className="text-base">🧭</span> Browse Jamin
          </a>
          <a href="#" className="flex items-center gap-1.5 hover:text-[#0D473B] transition">
            <span className="text-base">🗺️</span> Map View
          </a>
          <a href="#" className="flex items-center gap-1.5 hover:text-[#0D473B] transition">
            <span className="text-base">💼</span> Builder Portal
          </a>
          <a href="#" className="flex items-center gap-1.5 hover:text-[#0D473B] transition">
            <span className="text-base">🏷️</span> Pricing Plans
          </a>
          <a href="#" className="flex items-center gap-1.5 hover:text-[#0D473B] transition">
            <span className="text-base">ℹ️</span> About Us
          </a>
          <a href="#" className="flex items-center gap-1.5 hover:text-[#0D473B] transition">
            <span className="text-base">📞</span> Contact Us
          </a>
        </nav>

        {/* ACTION BUTTONS */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700">
            <span>🎙️</span>
            <span>🌐 EN</span>
          </div>

          {showTimelineToggle && onToggleTimeline && (
            <button
              onClick={onToggleTimeline}
              className="px-4 py-2 bg-[#0D473B] hover:bg-[#09352C] text-white font-bold rounded-full text-xs sm:text-sm shadow-md transition flex items-center gap-1.5"
            >
              <span>✨</span> Timeline Editor
            </button>
          )}

          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#0D473B] font-bold text-sm cursor-pointer hover:bg-emerald-100 transition">
              👤
            </div>
          </div>
        </div>

      </div>
    </header>
  );
};
