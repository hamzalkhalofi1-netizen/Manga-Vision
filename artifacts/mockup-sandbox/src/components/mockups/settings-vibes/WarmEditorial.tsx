import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun, Smartphone, Monitor, BookOpen, Database, Globe } from "lucide-react";

export function WarmEditorial() {
  const [theme, setTheme] = useState("dark");
  const [readingMode, setReadingMode] = useState("vertical");
  const [showPageNumber, setShowPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [targetLang, setTargetLang] = useState("English");

  const languages = [
    "English", "العربية", "Español", "Português", 
    "Français", "Deutsch", "日本語", "한국어", "中文"
  ];

  return (
    <div style={{ 
      width: 390, 
      minHeight: 844, 
      overflow: 'auto',
      backgroundColor: '#1a1510',
      color: '#f5eed8',
      fontFamily: 'ui-sans-serif, system-ui, sans-serif'
    }}>
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap');
          
          .font-editorial {
            font-family: "Playfair Display", serif;
          }
        `}
      </style>

      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center px-4 py-4" style={{ backgroundColor: '#1a1510e6', backdropFilter: 'blur(8px)' }}>
        <button className="p-2 -ml-2 rounded-full hover:bg-white/5 transition-colors">
          <ChevronLeft size={24} style={{ color: '#d97706' }} />
        </button>
        <h1 className="ml-2 text-2xl font-editorial font-semibold tracking-wide">Settings</h1>
      </div>

      <div className="px-4 pb-12 space-y-8 mt-2">
        
        {/* APPEARANCE */}
        <section className="space-y-3">
          <h2 className="font-editorial text-sm font-medium tracking-widest uppercase" style={{ color: '#d97706' }}>
            Appearance
          </h2>
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: '#231d17', border: '1px solid #3d3328' }}>
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium">Theme</span>
              </div>
              <div className="flex bg-[#1a1510] p-1 rounded-lg border border-[#3d3328]">
                {['auto', 'light', 'dark'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 flex items-center justify-center py-2 px-3 rounded-md text-sm font-medium transition-all ${
                      theme === t ? 'bg-[#231d17] shadow-sm' : 'opacity-60 hover:opacity-100'
                    }`}
                    style={theme === t ? { color: '#d97706', border: '1px solid #3d3328' } : {}}
                  >
                    {t === 'auto' && <Smartphone size={16} className="mr-2" />}
                    {t === 'light' && <Sun size={16} className="mr-2" />}
                    {t === 'dark' && <Moon size={16} className="mr-2" />}
                    <span className="capitalize">{t}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* READER */}
        <section className="space-y-3">
          <h2 className="font-editorial text-sm font-medium tracking-widest uppercase" style={{ color: '#d97706' }}>
            Reader
          </h2>
          <div className="rounded-xl overflow-hidden divide-y divide-[#3d3328]" style={{ backgroundColor: '#231d17', border: '1px solid #3d3328' }}>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#1a1510] border border-[#3d3328]">
                  <BookOpen size={16} style={{ color: '#d97706' }} />
                </div>
                <span className="text-sm font-medium">Reading Mode</span>
              </div>
              <div className="flex bg-[#1a1510] p-1 rounded-lg border border-[#3d3328]">
                {['vertical', 'horizontal'].map((m) => (
                  <button
                    key={m}
                    onClick={() => setReadingMode(m)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      readingMode === m ? 'bg-[#231d17]' : 'opacity-60'
                    }`}
                    style={readingMode === m ? { color: '#d97706', border: '1px solid #3d3328' } : {}}
                  >
                    <span className="capitalize">{m}</span>
                  </button>
                ))}
              </div>
            </div>
            
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#1a1510] border border-[#3d3328]">
                  <Monitor size={16} style={{ color: '#d97706' }} />
                </div>
                <div>
                  <div className="text-sm font-medium">Show Page Number</div>
                  <div className="text-xs opacity-60 mt-0.5">Display current page in reader</div>
                </div>
              </div>
              <button 
                onClick={() => setShowPageNumber(!showPageNumber)}
                className="w-12 h-6 rounded-full relative transition-colors duration-300"
                style={{ backgroundColor: showPageNumber ? '#d97706' : '#1a1510', border: `1px solid ${showPageNumber ? '#d97706' : '#3d3328'}` }}
              >
                <div 
                  className="w-5 h-5 rounded-full bg-[#f5eed8] absolute top-0.5 transition-transform duration-300 shadow-sm"
                  style={{ transform: showPageNumber ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          </div>
        </section>

        {/* DATA & PERFORMANCE */}
        <section className="space-y-3">
          <h2 className="font-editorial text-sm font-medium tracking-widest uppercase" style={{ color: '#d97706' }}>
            Data & Performance
          </h2>
          <div className="rounded-xl overflow-hidden divide-y divide-[#3d3328]" style={{ backgroundColor: '#231d17', border: '1px solid #3d3328' }}>
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#1a1510] border border-[#3d3328]">
                  <Database size={16} style={{ color: '#d97706' }} />
                </div>
                <div>
                  <div className="text-sm font-medium">Data Saver</div>
                  <div className="text-xs opacity-60 mt-0.5">Reduce image quality</div>
                </div>
              </div>
              <button 
                onClick={() => setDataSaver(!dataSaver)}
                className="w-12 h-6 rounded-full relative transition-colors duration-300"
                style={{ backgroundColor: dataSaver ? '#d97706' : '#1a1510', border: `1px solid ${dataSaver ? '#d97706' : '#3d3328'}` }}
              >
                <div 
                  className="w-5 h-5 rounded-full bg-[#f5eed8] absolute top-0.5 transition-transform duration-300 shadow-sm"
                  style={{ transform: dataSaver ? 'translateX(22px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
            
            <button className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors text-left">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#1a1510] border border-[#3d3328]">
                  <BookOpen size={16} style={{ color: '#d97706' }} />
                </div>
                <div className="text-sm font-medium">Clear Translation Cache</div>
              </div>
              <div className="text-xs opacity-60">124 MB</div>
            </button>
          </div>
        </section>

        {/* AI TRANSLATION */}
        <section className="space-y-3">
          <h2 className="font-editorial text-sm font-medium tracking-widest uppercase" style={{ color: '#d97706' }}>
            AI Translation
          </h2>
          <div className="rounded-xl overflow-hidden divide-y divide-[#3d3328]" style={{ backgroundColor: '#231d17', border: '1px solid #3d3328' }}>
            <button className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#1a1510] border border-[#3d3328]">
                  <Globe size={16} style={{ color: '#d97706' }} />
                </div>
                <span className="text-sm font-medium">Target Language</span>
              </div>
              <div className="flex items-center gap-1 opacity-60">
                <span className="text-sm">{targetLang}</span>
                <ChevronRight size={16} />
              </div>
            </button>
            
            <div className="p-4">
              <div className="flex flex-wrap gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setTargetLang(lang)}
                    className={`px-3 py-1.5 rounded-full text-xs transition-all border ${
                      targetLang === lang 
                        ? 'bg-[#d97706]/10 text-[#d97706] border-[#d97706]/30' 
                        : 'bg-[#1a1510] border-[#3d3328] hover:border-[#d97706]/50 opacity-80'
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
