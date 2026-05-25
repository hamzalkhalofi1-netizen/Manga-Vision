import React, { useState } from 'react';
import { 
  Zap, 
  Moon, 
  Sun, 
  Monitor, 
  Smartphone, 
  BookOpen, 
  ChevronDown,
  Hash,
  Wifi,
  Database,
  Globe,
  Settings
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const LANGUAGES = ['English', 'العربية', 'Español', 'Português', 'Français', 'Deutsch', '日本語', '한국어', '中文'];

export function FrequencyFirst() {
  const [theme, setTheme] = useState('auto');
  const [readingMode, setReadingMode] = useState('vertical');
  const [language, setLanguage] = useState('English');
  const [moreExpanded, setMoreExpanded] = useState(false);
  
  const [pageNumber, setPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [translationCache, setTranslationCache] = useState(true);

  return (
    <div 
      style={{ 
        width: 390, 
        minHeight: 844, 
        overflow: 'auto',
        backgroundColor: '#0a0a0e',
        color: 'white',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}
      className="relative flex flex-col items-center select-none"
    >
      {/* Header */}
      <div className="w-full px-6 pt-14 pb-6 flex items-center justify-between sticky top-0 z-10" style={{ backgroundColor: 'rgba(10, 10, 14, 0.85)', backdropFilter: 'blur(12px)' }}>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      </div>

      <div className="w-full px-4 pb-12 flex flex-col gap-4">
        
        {/* Quick Settings Hero Card */}
        <div 
          className="rounded-3xl p-5 flex flex-col gap-6"
          style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.05)' }}
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full" style={{ backgroundColor: 'rgba(255, 45, 85, 0.15)' }}>
              <Zap size={18} color="#ff2d55" className="fill-[#ff2d55]" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight">Quick Settings</h2>
          </div>

          {/* Theme */}
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-white/60 uppercase tracking-wider text-[11px]">Theme</span>
            <div className="flex p-1 rounded-2xl" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
              {[
                { id: 'auto', label: 'Auto', icon: <Monitor size={14} /> },
                { id: 'light', label: 'Light', icon: <Sun size={14} /> },
                { id: 'dark', label: 'Dark', icon: <Moon size={14} /> },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all",
                    theme === t.id ? "bg-[#2a2a30] text-white shadow-sm" : "text-white/50 hover:text-white/80"
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reading Mode */}
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium text-white/60 uppercase tracking-wider text-[11px]">Reading Mode</span>
            <div className="flex p-1 rounded-2xl" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
              {[
                { id: 'vertical', label: 'Vertical Scroll', icon: <Smartphone size={14} /> },
                { id: 'horizontal', label: 'Horizontal', icon: <BookOpen size={14} /> },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setReadingMode(m.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium transition-all",
                    readingMode === m.id ? "bg-[#2a2a30] text-white shadow-sm" : "text-white/50 hover:text-white/80"
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target Language */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white/60 uppercase tracking-wider text-[11px]">Target Language</span>
              <span className="text-sm font-medium" style={{ color: '#ff2d55' }}>{language}</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  onClick={() => setLanguage(lang)}
                  className={cn(
                    "py-2.5 rounded-xl text-sm font-medium transition-all border",
                    language === lang 
                      ? "border-[#ff2d55] bg-[#ff2d55]/10 text-[#ff2d55]" 
                      : "border-white/5 text-white/60 hover:bg-white/5 hover:text-white"
                  )}
                  style={language !== lang ? { backgroundColor: 'rgba(0,0,0,0.2)' } : {}}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* More Settings Collapsible */}
        <div 
          className="rounded-3xl overflow-hidden transition-all duration-300"
          style={{ backgroundColor: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.03)' }}
        >
          <button 
            onClick={() => setMoreExpanded(!moreExpanded)}
            className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}>
                <Settings size={18} className="text-white/70" />
              </div>
              <span className="text-base font-medium">More Settings</span>
            </div>
            <ChevronDown 
              size={20} 
              className={cn(
                "text-white/40 transition-transform duration-300", 
                moreExpanded ? "rotate-180" : ""
              )} 
            />
          </button>
          
          <div 
            className={cn(
              "grid transition-all duration-300 ease-in-out",
              moreExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            )}
          >
            <div className="overflow-hidden flex flex-col">
              <div className="h-[1px] w-full bg-white/5 mx-5 w-[calc(100%-40px)]" />
              
              <div className="p-2">
                <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <Hash size={18} className="text-white/50" />
                    <span className="text-[15px]">Show Page Number</span>
                  </div>
                  <Switch checked={pageNumber} onCheckedChange={setPageNumber} />
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <Wifi size={18} className="text-white/50" />
                    <span className="text-[15px]">Data Saver</span>
                  </div>
                  <Switch checked={dataSaver} onCheckedChange={setDataSaver} />
                </div>
                
                <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-white/5 transition-colors">
                  <div className="flex items-center gap-3">
                    <Database size={18} className="text-white/50" />
                    <span className="text-[15px]">Translation Cache</span>
                  </div>
                  <Switch checked={translationCache} onCheckedChange={setTranslationCache} />
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
