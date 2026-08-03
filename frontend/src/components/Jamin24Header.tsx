import React from "react";

interface Jamin24HeaderProps {
  onToggleTimeline?: () => void;
  showTimelineToggle?: boolean;
  activeScreen?: 'reel' | 'timeline';
}

export const Jamin24Header: React.FC<Jamin24HeaderProps> = ({
  onToggleTimeline,
  showTimelineToggle = true,
  activeScreen = 'reel',
}) => {
  return (
    <header className="w-full bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        
        {/* LOGO */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#0D473B] text-white shadow-md border-2 border-amber-400">
            {/* Compass Symbol */}
            <svg className="w-5 h-5 sm:w-7 sm:h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" stroke="#EAB308" strokeWidth="1.5" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="#EAB308" stroke="#0D473B" strokeWidth="1" />
            </svg>
          </div>
          <div>
            <span className="text-xl sm:text-2xl font-black tracking-tight text-[#0D473B] uppercase font-sans">
              Jamin<span className="text-amber-500">24</span>
            </span>
            <span className="block text-[8px] sm:text-[10px] uppercase font-bold tracking-widest text-slate-500 -mt-1">
              AI Video HUB
            </span>
          </div>
        </div>



        {/* ACTION BUTTONS */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full px-3 py-1.5 text-xs font-semibold text-slate-700">
            <span>🎙️</span>
            <span>🌐 GUJ / EN</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#0D473B] font-bold text-xs sm:text-sm cursor-pointer hover:bg-emerald-100 transition">
              👤
            </div>
          </div>
        </div>

      </div>
    </header>
  );
};
