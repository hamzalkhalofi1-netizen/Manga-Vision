import React, { useState } from 'react';
import { 
  Sparkles, 
  Book, 
  Zap, 
  Globe, 
  ChevronLeft
} from 'lucide-react';

const LANGUAGES = [
  'English', 'العربية', 'Español', 'Português', 'Français', 
  'Deutsch', '日本語', '한국어', '中文'
];

export function IntentDriven() {
  const [theme, setTheme] = useState('Auto');
  const [readingMode, setReadingMode] = useState('Vertical');
  const [showPageNumber, setShowPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [translationCache, setTranslationCache] = useState(true);
  const [targetLanguage, setTargetLanguage] = useState('English');

  return (
    <div 
      className="relative text-white font-sans flex flex-col"
      style={{ 
        width: 390, 
        minHeight: 844, 
        overflow: 'auto',
        backgroundColor: '#0a0a0e',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
    >
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center px-4 py-4 backdrop-blur-xl bg-[#0a0a0e]/80 border-b border-white/5">
        <button className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="ml-2 text-xl font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="px-5 py-6 space-y-10 pb-20">
        
        {/* Make It Yours */}
        <section className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white">
              <Sparkles className="w-4 h-4 text-[#ff2d55]" />
              <h2 className="text-[15px] font-medium tracking-wide">Make It Yours</h2>
            </div>
            <p className="text-[12px] text-white/40 pl-6">Adjust how the app looks</p>
          </div>
          
          <div className="bg-white/[0.04] rounded-2xl p-1 border border-white/[0.02]">
            <div className="flex relative">
              {['Auto', 'Light', 'Dark'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`flex-1 py-2.5 text-[13px] font-medium rounded-xl transition-all duration-300 relative z-10 ${
                    theme === t ? 'text-white' : 'text-white/40 hover:text-white/60'
                  }`}
                >
                  {t}
                </button>
              ))}
              <div 
                className="absolute top-0 bottom-0 rounded-xl transition-all duration-300 pointer-events-none"
                style={{
                  width: '33.333%',
                  left: theme === 'Auto' ? '0%' : theme === 'Light' ? '33.333%' : '66.666%',
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.05)'
                }}
              />
            </div>
          </div>
        </section>

        {/* How You Read */}
        <section className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white">
              <Book className="w-4 h-4 text-[#ff2d55]" />
              <h2 className="text-[15px] font-medium tracking-wide">How You Read</h2>
            </div>
            <p className="text-[12px] text-white/40 pl-6">Control how manga pages flip</p>
          </div>
          
          <div className="bg-white/[0.04] rounded-2xl border border-white/[0.02] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-white/[0.05] flex justify-between items-center">
              <span className="text-[15px]">Reading Mode</span>
              <div className="bg-white/[0.04] rounded-xl p-1 flex w-[140px] relative">
                {['Vertical', 'Horizontal'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setReadingMode(m)}
                    className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-all duration-300 relative z-10 ${
                      readingMode === m ? 'text-white' : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {m}
                  </button>
                ))}
                <div 
                  className="absolute top-1 bottom-1 rounded-lg transition-all duration-300 pointer-events-none"
                  style={{
                    width: 'calc(50% - 4px)',
                    left: readingMode === 'Vertical' ? '4px' : 'calc(50%)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                  }}
                />
              </div>
            </div>
            
            <div className="p-4 flex justify-between items-center">
              <span className="text-[15px]">Show Page Number</span>
              <button 
                onClick={() => setShowPageNumber(!showPageNumber)}
                className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${
                  showPageNumber ? 'bg-[#ff2d55]' : 'bg-white/10'
                }`}
              >
                <div 
                  className={`w-5 h-5 bg-white rounded-full transition-transform duration-300 shadow-md ${
                    showPageNumber ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Stay Fast */}
        <section className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white">
              <Zap className="w-4 h-4 text-[#ff2d55]" />
              <h2 className="text-[15px] font-medium tracking-wide">Stay Fast</h2>
            </div>
            <p className="text-[12px] text-white/40 pl-6">Reduce mobile data usage</p>
          </div>
          
          <div className="bg-white/[0.04] rounded-2xl border border-white/[0.02] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-white/[0.05] flex justify-between items-center">
              <div>
                <span className="text-[15px] block">Data Saver</span>
                <span className="text-[11px] text-white/40 mt-1 block">Compress images on cellular</span>
              </div>
              <button 
                onClick={() => setDataSaver(!dataSaver)}
                className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${
                  dataSaver ? 'bg-[#ff2d55]' : 'bg-white/10'
                }`}
              >
                <div 
                  className={`w-5 h-5 bg-white rounded-full transition-transform duration-300 shadow-md ${
                    dataSaver ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            
            <div className="p-4 flex justify-between items-center">
              <div>
                <span className="text-[15px] block">Translation Cache</span>
                <span className="text-[11px] text-white/40 mt-1 block">Save translations offline</span>
              </div>
              <button 
                onClick={() => setTranslationCache(!translationCache)}
                className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${
                  translationCache ? 'bg-[#ff2d55]' : 'bg-white/10'
                }`}
              >
                <div 
                  className={`w-5 h-5 bg-white rounded-full transition-transform duration-300 shadow-md ${
                    translationCache ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

        {/* Your Language */}
        <section className="space-y-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-white">
              <Globe className="w-4 h-4 text-[#ff2d55]" />
              <h2 className="text-[15px] font-medium tracking-wide">Your Language</h2>
            </div>
            <p className="text-[12px] text-white/40 pl-6">Translate speech bubbles to your language</p>
          </div>
          
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGES.map((lang) => {
              const isActive = targetLanguage === lang;
              return (
                <button
                  key={lang}
                  onClick={() => setTargetLanguage(lang)}
                  className={`
                    py-3 px-2 rounded-xl text-[13px] font-medium transition-all duration-300 border
                    ${isActive 
                      ? 'bg-gradient-to-b from-[#ff2d55]/20 to-[#ff2d55]/5 border-[#ff2d55]/50 text-white shadow-[0_0_15px_rgba(255,45,85,0.1)]' 
                      : 'bg-white/[0.02] border-white/[0.02] text-white/40 hover:bg-white/[0.06] hover:text-white'
                    }
                  `}
                >
                  {lang}
                </button>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
