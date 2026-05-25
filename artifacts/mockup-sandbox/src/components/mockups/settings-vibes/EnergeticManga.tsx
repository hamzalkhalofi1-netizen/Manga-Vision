import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun, Monitor, Type, Trash2, Database, Languages } from "lucide-react";

export function EnergeticManga() {
  const [theme, setTheme] = useState("auto");
  const [readingMode, setReadingMode] = useState("vertical");
  const [showPageNumber, setShowPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [targetLang, setTargetLang] = useState("English");

  const languages = ["English", "العربية", "Español", "Português", "Français", "Deutsch", "日本語", "한국어", "中文"];

  return (
    <div className="relative font-sans text-white" style={{ width: 390, minHeight: 844, overflow: 'auto', backgroundColor: '#0d0d0d' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bangers&display=swap');
        
        .font-bangers {
          font-family: 'Bangers', cursive;
          letter-spacing: 0.05em;
        }

        .halftone-bg {
          background-image: radial-gradient(#ff0028 15%, transparent 16%), radial-gradient(#ff0028 15%, transparent 16%);
          background-size: 8px 8px;
          background-position: 0 0, 4px 4px;
          opacity: 0.2;
        }

        .manga-border {
          border-left: 4px solid #ff0028;
          border-bottom: 2px solid #333;
          border-right: 2px solid #333;
          border-top: 2px solid #333;
          background-color: #1a1a1a;
          transform: skew(-2deg);
        }
        
        .manga-border > * {
          transform: skew(2deg);
        }

        .manga-button {
          transition: all 0.1s ease-in-out;
          border: 2px solid transparent;
        }
        
        .manga-button:active {
          transform: scale(0.95) skew(-2deg);
        }
        
        .manga-button.active {
          background-color: #ff0028;
          border-color: #ff0028;
          color: white;
          font-weight: bold;
          transform: skew(-5deg);
        }
        
        .manga-button.active > * {
          transform: skew(5deg);
        }
        
        .manga-button.inactive {
          background-color: transparent;
          border-color: #555;
          color: #aaa;
          transform: skew(-5deg);
        }
        
        .manga-button.inactive > * {
          transform: skew(5deg);
        }

        /* Custom Switch */
        .manga-switch {
          width: 44px;
          height: 24px;
          background-color: #333;
          border: 2px solid #555;
          position: relative;
          cursor: pointer;
          transition: background-color 0.2s;
          transform: skew(-5deg);
        }
        .manga-switch.on {
          background-color: #ff0028;
          border-color: #ff0028;
        }
        .manga-switch-knob {
          width: 16px;
          height: 16px;
          background-color: white;
          position: absolute;
          top: 2px;
          left: 2px;
          transition: transform 0.2s;
        }
        .manga-switch.on .manga-switch-knob {
          transform: translateX(20px);
        }
      `}</style>

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0d0d0d] border-b-4 border-[#ff0028] px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button className="p-2 -ml-2 text-white hover:text-[#ff0028] transition-colors">
            <ChevronLeft size={28} strokeWidth={3} />
          </button>
          <h1 className="font-bangers text-3xl text-white uppercase tracking-wider drop-shadow-[2px_2px_0px_#ff0028]">Settings</h1>
        </div>
        <div className="w-10 h-10 bg-[#ffcc00] flex items-center justify-center transform skew-x-[-10deg] border-2 border-black">
          <span className="font-bangers text-black text-xl transform skew-x-[10deg]">V.2</span>
        </div>
      </div>

      <div className="p-4 space-y-8 pb-12">
        {/* APPEARANCE */}
        <section>
          <div className="relative mb-4 overflow-hidden py-2 px-3 border-l-4 border-[#ffcc00] bg-[#1a1a1a]">
            <div className="absolute inset-0 halftone-bg pointer-events-none"></div>
            <h2 className="font-bangers text-2xl text-white relative z-10 tracking-widest drop-shadow-[1px_1px_0px_black]">APPEARANCE</h2>
          </div>
          
          <div className="manga-border p-4">
            <div className="flex justify-between items-center mb-4">
              <span className="font-bold text-lg">Theme</span>
            </div>
            <div className="flex gap-2 w-full">
              {['auto', 'light', 'dark'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  className={`manga-button flex-1 py-3 text-center uppercase font-bangers text-xl ${theme === t ? 'active drop-shadow-[2px_2px_0px_black]' : 'inactive'}`}
                >
                  <div>
                    {t === 'auto' && <Monitor size={18} className="inline mr-2 mb-1" />}
                    {t === 'light' && <Sun size={18} className="inline mr-2 mb-1" />}
                    {t === 'dark' && <Moon size={18} className="inline mr-2 mb-1" />}
                    {t}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* READER */}
        <section>
          <div className="relative mb-4 overflow-hidden py-2 px-3 border-l-4 border-[#ffcc00] bg-[#1a1a1a]">
            <div className="absolute inset-0 halftone-bg pointer-events-none"></div>
            <h2 className="font-bangers text-2xl text-white relative z-10 tracking-widest drop-shadow-[1px_1px_0px_black]">READER</h2>
          </div>
          
          <div className="space-y-3">
            <div className="manga-border p-4">
              <div className="flex justify-between items-center mb-4">
                <span className="font-bold text-lg">Reading Mode</span>
              </div>
              <div className="flex gap-2 w-full">
                <button
                  onClick={() => setReadingMode('vertical')}
                  className={`manga-button flex-1 py-3 text-center uppercase font-bangers text-xl ${readingMode === 'vertical' ? 'active drop-shadow-[2px_2px_0px_black]' : 'inactive'}`}
                >
                  <div>VERTICAL</div>
                </button>
                <button
                  onClick={() => setReadingMode('horizontal')}
                  className={`manga-button flex-1 py-3 text-center uppercase font-bangers text-xl ${readingMode === 'horizontal' ? 'active drop-shadow-[2px_2px_0px_black]' : 'inactive'}`}
                >
                  <div>HORIZONTAL</div>
                </button>
              </div>
            </div>

            <div className="manga-border p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Type className="text-[#ffcc00]" />
                <span className="font-bold text-lg">Show Page Number</span>
              </div>
              <div 
                className={`manga-switch ${showPageNumber ? 'on' : ''}`}
                onClick={() => setShowPageNumber(!showPageNumber)}
              >
                <div className="manga-switch-knob"></div>
              </div>
            </div>
          </div>
        </section>

        {/* DATA & PERFORMANCE */}
        <section>
          <div className="relative mb-4 overflow-hidden py-2 px-3 border-l-4 border-[#ffcc00] bg-[#1a1a1a]">
            <div className="absolute inset-0 halftone-bg pointer-events-none"></div>
            <h2 className="font-bangers text-2xl text-white relative z-10 tracking-widest drop-shadow-[1px_1px_0px_black]">DATA & PERF.</h2>
          </div>
          
          <div className="space-y-3">
            <div className="manga-border p-4 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Database className="text-[#ffcc00]" />
                <div>
                  <div className="font-bold text-lg">Data Saver</div>
                  <div className="text-xs text-gray-400 mt-1 uppercase font-bold tracking-wider">Compress images</div>
                </div>
              </div>
              <div 
                className={`manga-switch ${dataSaver ? 'on' : ''}`}
                onClick={() => setDataSaver(!dataSaver)}
              >
                <div className="manga-switch-knob"></div>
              </div>
            </div>

            <div className="manga-border p-4 flex justify-between items-center bg-[#1a1a1a] hover:bg-[#222] cursor-pointer">
              <div className="flex items-center gap-3">
                <Trash2 className="text-[#ff0028]" />
                <div>
                  <div className="font-bold text-lg">Clear Cache</div>
                  <div className="text-xs text-[#ff0028] mt-1 uppercase font-bold tracking-wider">342 MB used</div>
                </div>
              </div>
              <ChevronRight className="text-gray-500" />
            </div>
          </div>
        </section>

        {/* AI TRANSLATION */}
        <section>
          <div className="relative mb-4 overflow-hidden py-2 px-3 border-l-4 border-[#ffcc00] bg-[#1a1a1a]">
            <div className="absolute inset-0 halftone-bg pointer-events-none"></div>
            <h2 className="font-bangers text-2xl text-white relative z-10 tracking-widest drop-shadow-[1px_1px_0px_black]">AI TRANSLATION</h2>
          </div>
          
          <div className="manga-border p-4">
            <div className="flex items-center gap-3 mb-4">
              <Languages className="text-[#ffcc00]" />
              <span className="font-bold text-lg">Target Language</span>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {languages.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setTargetLang(lang)}
                  className={`px-4 py-2 uppercase font-bold tracking-wider text-sm transition-all transform skew-x-[-10deg] ${
                    targetLang === lang 
                      ? 'bg-[#ff0028] text-white border-2 border-[#ff0028] drop-shadow-[2px_2px_0px_black]' 
                      : 'bg-transparent border-2 border-[#555] text-gray-300 hover:border-[#ffcc00] hover:text-[#ffcc00]'
                  }`}
                >
                  <div className="transform skew-x-[10deg]">{lang}</div>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
