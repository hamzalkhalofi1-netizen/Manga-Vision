import React, { useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  Smartphone,
  ArrowRight,
  ArrowDown,
  Wifi,
  HardDrive,
  Check
} from 'lucide-react';
import { cn } from '@/lib/utils';

const LANGUAGES = [
  'English', 'العربية', 'Español', 
  'Português', 'Français', 'Deutsch', 
  '日本語', '한국어', '中文'
];

export function ControlDashboard() {
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>('auto');
  const [readingMode, setReadingMode] = useState<'vertical' | 'horizontal'>('vertical');
  const [showPageNumber, setShowPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState<'save' | 'max'>('max');
  const [translationCache, setTranslationCache] = useState(true);
  const [targetLanguage, setTargetLanguage] = useState('English');

  return (
    <div 
      style={{ width: 390, minHeight: 844, overflow: 'auto' }}
      className="bg-[#0a0a0e] text-white p-4 font-sans select-none"
    >
      <div className="flex items-center justify-between mb-8 mt-4 px-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 pb-12">
        
        {/* Theme Pod */}
        <div className="col-span-2 bg-white/[0.04] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-4">
          <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Theme</span>
          <div className="flex gap-2 h-14">
            {(['auto', 'light', 'dark'] as const).map((t) => {
              const isActive = theme === t;
              const Icon = t === 'auto' ? Monitor : t === 'light' ? Sun : Moon;
              return (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-center rounded-2xl transition-all duration-300 relative overflow-hidden",
                    isActive ? "bg-[#ff2d55]/10 border border-[#ff2d55]/50" : "bg-white/[0.02] border border-transparent hover:bg-white/[0.06]"
                  )}
                >
                  <Icon className={cn("w-5 h-5 mb-1 transition-colors", isActive ? "text-[#ff2d55]" : "text-white/60")} />
                  <span className={cn("text-[10px] uppercase font-bold tracking-wider", isActive ? "text-[#ff2d55]" : "text-white/40")}>
                    {t}
                  </span>
                  {isActive && (
                    <div className="absolute inset-0 bg-[#ff2d55]/20 blur-xl pointer-events-none" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Reading Mode Pod */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-4">
          <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Reading</span>
          <div className="flex justify-between h-24 gap-2">
            <button
              onClick={() => setReadingMode('vertical')}
              className={cn(
                "flex-1 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all",
                readingMode === 'vertical' ? "border-[#ff2d55] bg-[#ff2d55]/10" : "border-white/[0.08] bg-white/[0.02]"
              )}
            >
              <div className="w-6 h-10 border-2 rounded-sm flex items-center justify-center border-current opacity-80">
                <ArrowDown className="w-3 h-3" />
              </div>
              <span className={cn("text-[9px] uppercase font-bold", readingMode === 'vertical' ? "text-[#ff2d55]" : "text-white/40")}>Vert</span>
            </button>
            <button
              onClick={() => setReadingMode('horizontal')}
              className={cn(
                "flex-1 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all",
                readingMode === 'horizontal' ? "border-[#ff2d55] bg-[#ff2d55]/10" : "border-white/[0.08] bg-white/[0.02]"
              )}
            >
              <div className="w-10 h-6 border-2 rounded-sm flex items-center justify-center border-current opacity-80">
                <ArrowRight className="w-3 h-3" />
              </div>
              <span className={cn("text-[9px] uppercase font-bold", readingMode === 'horizontal' ? "text-[#ff2d55]" : "text-white/40")}>Horz</span>
            </button>
          </div>
        </div>

        {/* Page Number Pod */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-4">
          <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Page Nums</span>
          <button
            onClick={() => setShowPageNumber(!showPageNumber)}
            className="flex-1 flex items-center justify-center h-24"
          >
            <div className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border-2",
              showPageNumber 
                ? "border-[#ff2d55] bg-[#ff2d55]/10 shadow-[0_0_20px_rgba(255,45,85,0.2)]" 
                : "border-white/10 bg-white/[0.02]"
            )}>
              <span className={cn(
                "text-xl font-bold tracking-wider transition-colors",
                showPageNumber ? "text-[#ff2d55]" : "text-white/20"
              )}>
                {showPageNumber ? 'ON' : 'OFF'}
              </span>
            </div>
          </button>
        </div>

        {/* Data Saver Pod */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Data Saver</span>
            <Wifi className="w-3 h-3 text-white/40" />
          </div>
          <button
            onClick={() => setDataSaver(prev => prev === 'max' ? 'save' : 'max')}
            className="flex-1 flex items-center justify-center h-24"
          >
            <div className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border-2",
              dataSaver === 'save'
                ? "border-[#ff2d55] bg-[#ff2d55]/10 shadow-[0_0_20px_rgba(255,45,85,0.2)]" 
                : "border-white/10 bg-white/[0.02]"
            )}>
              <span className={cn(
                "text-lg font-bold tracking-wider transition-colors",
                dataSaver === 'save' ? "text-[#ff2d55]" : "text-white/40"
              )}>
                {dataSaver === 'save' ? 'SAVE' : 'MAX'}
              </span>
            </div>
          </button>
        </div>

        {/* Translation Cache Pod */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Cache</span>
            <HardDrive className="w-3 h-3 text-white/40" />
          </div>
          <button
            onClick={() => setTranslationCache(!translationCache)}
            className="flex-1 flex items-center justify-center h-24"
          >
            <div className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 border-2",
              translationCache
                ? "border-[#ff2d55] bg-[#ff2d55]/10 shadow-[0_0_20px_rgba(255,45,85,0.2)]" 
                : "border-white/10 bg-white/[0.02]"
            )}>
              <span className={cn(
                "text-xl font-bold tracking-wider transition-colors",
                translationCache ? "text-[#ff2d55]" : "text-white/20"
              )}>
                {translationCache ? 'ON' : 'OFF'}
              </span>
            </div>
          </button>
        </div>

        {/* Target Language Pod */}
        <div className="col-span-2 bg-white/[0.04] border border-white/[0.08] rounded-3xl p-4 flex flex-col gap-4">
          <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">Target Language</span>
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGES.map(lang => {
              const isActive = targetLanguage === lang;
              return (
                <button
                  key={lang}
                  onClick={() => setTargetLanguage(lang)}
                  className={cn(
                    "h-10 rounded-2xl flex items-center justify-center text-[11px] font-medium transition-all duration-300 relative",
                    isActive 
                      ? "bg-[#ff2d55] text-white shadow-[0_0_15px_rgba(255,45,85,0.3)]" 
                      : "bg-white/[0.03] text-white/60 hover:bg-white/[0.08]"
                  )}
                >
                  {lang}
                </button>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  );
}
