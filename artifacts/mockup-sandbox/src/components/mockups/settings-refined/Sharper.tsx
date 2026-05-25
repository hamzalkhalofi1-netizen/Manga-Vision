import React, { useState } from 'react';
import { ChevronLeft, Moon, Sun, Smartphone, BookOpen, Hash, Wifi, HardDrive, Languages, ChevronRight, Monitor } from 'lucide-react';

function cls(...args: (string | boolean | undefined | null)[]): string {
  return args.filter(Boolean).join(' ');
}

export function Sharper() {
  const [theme, setTheme] = useState('auto');
  const [readingMode, setReadingMode] = useState('vertical');
  const [showPageNumber, setShowPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [targetLang, setTargetLang] = useState('English');

  const languages = ['English', 'العربية', 'Español', 'Português', 'Français', 'Deutsch', '日本語', '한국어', '中文'];

  return (
    <div
      className="relative flex flex-col bg-[#0e0e11] text-white font-sans overflow-x-hidden"
      style={{ width: 390, minHeight: 844, overflowY: 'auto' }}
    >
      <style dangerouslySetInnerHTML={{ __html: `
        .sh-section-header { position: relative; padding-left: 12px; margin-bottom: 12px; }
        .sh-section-header::before {
          content: ''; position: absolute; left: 0; top: 50%; transform: translateY(-50%);
          width: 2px; height: 14px; background-color: #e63946; border-radius: 2px;
        }
        .sh-icon-box {
          background-color: rgba(230,57,70,0.10);
          box-shadow: inset 0 0 0 1px rgba(230,57,70,0.15), inset 0 0 8px rgba(230,57,70,0.10);
          border-radius: 6px;
        }
        .sh-card { background-color: #1a1a1f; border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; }
        .sh-pill-group {
          background-color: #0e0e11; border: 1px solid rgba(255,255,255,0.05);
          border-radius: 6px; padding: 2px; display: flex;
        }
        .sh-pill { border-radius: 4px; transition: all 0.2s ease; flex: 1; padding: 8px 12px;
          font-size: 14px; font-weight: 500; display: flex; align-items: center; justify-content: center; gap: 6px; }
        .sh-pill.active { background-color: rgba(230,57,70,0.15); color: #e63946; box-shadow: inset 0 0 0 1px rgba(230,57,70,0.3); }
        .sh-pill:not(.active) { color: rgba(255,255,255,0.6); }
        .sh-lang-pill { border: 1px solid rgba(255,255,255,0.10); border-radius: 4px; transition: all 0.2s ease; }
        .sh-lang-pill.active { background-color: rgba(230,57,70,0.15); border-color: rgba(230,57,70,0.4); color: #e63946; }
        .sh-switch { width: 44px; height: 24px; border-radius: 12px; padding: 2px; transition: all 0.2s ease; display: flex; align-items: center; }
        .sh-switch-knob { width: 20px; height: 20px; border-radius: 10px; background-color: white; transition: all 0.2s ease; }
        .sh-switch.on { background-color: #e63946; }
        .sh-switch.off { background-color: rgba(255,255,255,0.2); }
        .sh-switch.on .sh-switch-knob { transform: translateX(20px); }
        .sh-separator { height: 1px; background-color: rgba(255,255,255,0.06); margin-left: 52px; }
      `}} />

      {/* Header */}
      <div className="flex items-center px-4 py-4 pt-12 sticky top-0 z-10 border-b border-white/5" style={{ backgroundColor: 'rgba(14,14,17,0.9)' }}>
        <button className="p-2 -ml-2 rounded-md hover:bg-white/5 transition-colors">
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>
        <h1 className="text-lg font-medium ml-2 tracking-wide">Settings</h1>
      </div>

      <div className="px-4 py-6 space-y-8">

        {/* APPEARANCE */}
        <section>
          <div className="sh-section-header">
            <h2 className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>Appearance</h2>
          </div>
          <div className="sh-card p-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="sh-icon-box w-8 h-8 flex items-center justify-center">
                <Monitor className="w-4 h-4 text-[#e63946]" />
              </div>
              <span className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Theme</span>
            </div>
            <div className="sh-pill-group">
              <button onClick={() => setTheme('auto')} className={cls('sh-pill', theme === 'auto' && 'active')}>
                <Smartphone className="w-3.5 h-3.5" />Auto
              </button>
              <button onClick={() => setTheme('light')} className={cls('sh-pill', theme === 'light' && 'active')}>
                <Sun className="w-3.5 h-3.5" />Light
              </button>
              <button onClick={() => setTheme('dark')} className={cls('sh-pill', theme === 'dark' && 'active')}>
                <Moon className="w-3.5 h-3.5" />Dark
              </button>
            </div>
          </div>
        </section>

        {/* READER */}
        <section>
          <div className="sh-section-header">
            <h2 className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>Reader</h2>
          </div>
          <div className="sh-card flex flex-col">
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="sh-icon-box w-8 h-8 flex items-center justify-center">
                  <BookOpen className="w-4 h-4 text-[#e63946]" />
                </div>
                <span className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Reading Mode</span>
              </div>
              <div className="sh-pill-group">
                <button onClick={() => setReadingMode('vertical')} className={cls('sh-pill', readingMode === 'vertical' && 'active')}>Vertical</button>
                <button onClick={() => setReadingMode('horizontal')} className={cls('sh-pill', readingMode === 'horizontal' && 'active')}>Horizontal</button>
              </div>
            </div>
            <div className="sh-separator" />
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="sh-icon-box w-8 h-8 flex items-center justify-center">
                  <Hash className="w-4 h-4 text-[#e63946]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Show Page Number</span>
                  <span className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Display current page while reading</span>
                </div>
              </div>
              <button onClick={() => setShowPageNumber(!showPageNumber)} className={cls('sh-switch', showPageNumber ? 'on' : 'off')}>
                <div className="sh-switch-knob" />
              </button>
            </div>
          </div>
        </section>

        {/* DATA & PERFORMANCE */}
        <section>
          <div className="sh-section-header">
            <h2 className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>Data &amp; Performance</h2>
          </div>
          <div className="sh-card flex flex-col">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="sh-icon-box w-8 h-8 flex items-center justify-center">
                  <Wifi className="w-4 h-4 text-[#e63946]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Data Saver</span>
                  <span className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>Compress images on mobile network</span>
                </div>
              </div>
              <button onClick={() => setDataSaver(!dataSaver)} className={cls('sh-switch', dataSaver ? 'on' : 'off')}>
                <div className="sh-switch-knob" />
              </button>
            </div>
            <div className="sh-separator" />
            <button className="p-4 flex items-center justify-between w-full hover:bg-white/[0.02] transition-colors">
              <div className="flex items-center gap-3">
                <div className="sh-icon-box w-8 h-8 flex items-center justify-center">
                  <HardDrive className="w-4 h-4 text-[#e63946]" />
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Translation Cache</span>
                  <span className="text-[12px] mt-0.5" style={{ color: 'rgba(255,255,255,0.4)' }}>No cached pages</span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5" style={{ color: 'rgba(255,255,255,0.3)' }} />
            </button>
          </div>
        </section>

        {/* AI TRANSLATION */}
        <section className="pb-8">
          <div className="sh-section-header">
            <h2 className="text-[11px] font-semibold tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.5)' }}>AI Translation</h2>
          </div>
          <div className="sh-card flex flex-col">
            <div className="p-4">
              <div className="flex items-center gap-3 mb-4">
                <div className="sh-icon-box w-8 h-8 flex items-center justify-center">
                  <Languages className="w-4 h-4 text-[#e63946]" />
                </div>
                <span className="text-[15px] font-medium" style={{ color: 'rgba(255,255,255,0.9)' }}>Target Language</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setTargetLang(lang)}
                    className={cls('sh-lang-pill py-2.5 px-2 text-[13px] font-medium text-center', targetLang === lang ? 'active' : '')}
                    style={targetLang !== lang ? { color: 'rgba(255,255,255,0.6)', backgroundColor: 'rgba(255,255,255,0.02)' } : {}}
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
