import React, { useState } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  Monitor, 
  Sun, 
  Moon, 
  BookOpen, 
  Hash, 
  Wifi, 
  Database, 
  Globe 
} from 'lucide-react';
import './_group.css';

export function Elevated() {
  const [theme, setTheme] = useState('dark');
  const [readMode, setReadMode] = useState('vertical');
  const [showPageNum, setShowPageNum] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [targetLang, setTargetLang] = useState('English');

  const languages = ['English', 'العربية', 'Español', 'Português', 'Français', 'Deutsch', '日本語', '한국어', '中文'];

  const CustomSwitch = ({ checked, onChange }: { checked: boolean, onChange: () => void }) => (
    <div 
      onClick={onChange}
      className={`relative inline-flex h-7 w-12 cursor-pointer items-center rounded-full transition-colors duration-300 ${checked ? 'bg-gradient-to-r from-[#ff2d55] to-[#e63946] shadow-[0_0_10px_rgba(255,45,85,0.3)]' : 'bg-white/10'}`}
    >
      <div 
        className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform duration-300 ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} 
      />
    </div>
  );

  return (
    <div style={{ width: 390, minHeight: 844, overflow: 'auto' }} className="elevated-container pb-12 selection:bg-[#ff2d55]/30">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0a0a0e]/80 backdrop-blur-xl border-b border-white/5 pt-12 pb-4 px-4 flex items-center justify-between">
        <button className="w-10 h-10 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold tracking-wide">Settings</h1>
        <div className="w-10 h-10" /> {/* Spacer */}
      </div>

      <div className="p-5 space-y-8">
        
        {/* APPEARANCE */}
        <section>
          <h2 className="text-xs font-bold tracking-widest text-gradient mb-3 px-1 uppercase">Appearance</h2>
          <div className="glass-card rounded-2xl overflow-hidden p-1">
            <div className="flex bg-black/40 p-1 rounded-xl">
              {[
                { id: 'auto', icon: Monitor, label: 'Auto' },
                { id: 'light', icon: Sun, label: 'Light' },
                { id: 'dark', icon: Moon, label: 'Dark' }
              ].map((opt) => {
                const isActive = theme === opt.id;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setTheme(opt.id)}
                    className={`flex-1 flex flex-col items-center justify-center py-3 rounded-lg transition-all duration-300 ${isActive ? 'toggle-active-gradient text-white' : 'text-white/50 hover:text-white/80'}`}
                  >
                    <Icon className={`w-5 h-5 mb-1.5 ${isActive ? '' : 'opacity-70'}`} />
                    <span className="text-[11px] font-medium">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* READER */}
        <section>
          <h2 className="text-xs font-bold tracking-widest text-gradient mb-3 px-1 uppercase">Reader</h2>
          <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/5">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#ff2d55]/10 flex items-center justify-center icon-glow border border-[#ff2d55]/20">
                  <BookOpen className="w-5 h-5 text-[#ff2d55] relative z-10" />
                </div>
                <div>
                  <div className="text-[15px] font-medium text-white">Reading Mode</div>
                  <div className="text-[12px] text-white/50 mt-0.5">Vertical or Horizontal</div>
                </div>
              </div>
              <div className="flex bg-black/40 p-1 rounded-lg">
                {['vertical', 'horizontal'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => setReadMode(mode)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${readMode === mode ? 'bg-white/15 text-white shadow-sm' : 'text-white/50'}`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#ff2d55]/10 flex items-center justify-center icon-glow border border-[#ff2d55]/20">
                  <Hash className="w-5 h-5 text-[#ff2d55] relative z-10" />
                </div>
                <div>
                  <div className="text-[15px] font-medium text-white">Show Page Number</div>
                  <div className="text-[12px] text-white/50 mt-0.5">Display current page</div>
                </div>
              </div>
              <CustomSwitch checked={showPageNum} onChange={() => setShowPageNum(!showPageNum)} />
            </div>
          </div>
        </section>

        {/* DATA & PERFORMANCE */}
        <section>
          <h2 className="text-xs font-bold tracking-widest text-gradient mb-3 px-1 uppercase">Data & Performance</h2>
          <div className="glass-card rounded-2xl overflow-hidden divide-y divide-white/5">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#ff2d55]/10 flex items-center justify-center icon-glow border border-[#ff2d55]/20">
                  <Wifi className="w-5 h-5 text-[#ff2d55] relative z-10" />
                </div>
                <div>
                  <div className="text-[15px] font-medium text-white">Data Saver</div>
                  <div className="text-[12px] text-white/50 mt-0.5">Compress images to save data</div>
                </div>
              </div>
              <CustomSwitch checked={dataSaver} onChange={() => setDataSaver(!dataSaver)} />
            </div>
            
            <button className="w-full p-4 flex items-center justify-between hover:bg-white/[0.02] transition-colors text-left">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#ff2d55]/10 flex items-center justify-center icon-glow border border-[#ff2d55]/20">
                  <Database className="w-5 h-5 text-[#ff2d55] relative z-10" />
                </div>
                <div>
                  <div className="text-[15px] font-medium text-white">Translation Cache</div>
                  <div className="text-[12px] text-white/50 mt-0.5">Manage downloaded translations</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-white/60">124 MB</span>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </div>
            </button>
          </div>
        </section>

        {/* AI TRANSLATION */}
        <section>
          <h2 className="text-xs font-bold tracking-widest text-gradient mb-3 px-1 uppercase">AI Translation</h2>
          <div className="glass-card rounded-2xl overflow-hidden flex flex-col p-4 gap-4">
            <div className="flex items-center justify-between pb-4 border-b border-white/5">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-[#ff2d55]/10 flex items-center justify-center icon-glow border border-[#ff2d55]/20">
                  <Globe className="w-5 h-5 text-[#ff2d55] relative z-10" />
                </div>
                <div>
                  <div className="text-[15px] font-medium text-white">Target Language</div>
                  <div className="text-[12px] text-white/50 mt-0.5">Selected: <span className="text-white font-medium">{targetLang}</span></div>
                </div>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2.5">
              {languages.map(lang => {
                const isActive = targetLang === lang;
                return (
                  <button
                    key={lang}
                    onClick={() => setTargetLang(lang)}
                    className={`px-3 py-2 rounded-xl text-[13px] font-medium border transition-all duration-300 ${
                      isActive 
                        ? 'bg-gradient-to-r from-[#ff2d55]/20 to-[#e63946]/20 border-[#ff2d55]/50 text-white shadow-[0_0_15px_rgba(255,45,85,0.15)]' 
                        : 'bg-black/20 border-white/10 text-white/60 hover:text-white hover:border-white/20'
                    }`}
                  >
                    {lang}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

      </div>
    </div>
  );
}
