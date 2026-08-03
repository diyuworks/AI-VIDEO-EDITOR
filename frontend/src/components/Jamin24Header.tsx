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

        {/* NAVIGATION / MODE TABS */}
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
          <button
            onClick={() => activeScreen !== 'reel' && onToggleTimeline && onToggleTimeline()}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 ${
              activeScreen === 'reel'
                ? 'bg-[#0D473B] text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>⚡</span>
            <span>Quick Reel Mode</span>
          </button>
          <button
            onClick={() => activeScreen !== 'timeline' && onToggleTimeline && onToggleTimeline()}
            className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 ${
              activeScreen === 'timeline'
                ? 'bg-[#0D473B] text-white shadow-md'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>🎬</span>
            <span>Timeline Studio</span>
          </button>
        </div>



      </div>
    </header>
  );
};
