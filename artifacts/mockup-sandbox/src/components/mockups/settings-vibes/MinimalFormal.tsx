import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Moon, Sun, Monitor, BookOpen, Smartphone, FileText, Database, Globe, Download, Zap } from "lucide-react";

export function MinimalFormal() {
  const [theme, setTheme] = useState("Auto");
  const [readingMode, setReadingMode] = useState("Vertical");
  const [showPageNumber, setShowPageNumber] = useState(true);
  const [dataSaver, setDataSaver] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");

  const languages = ["English", "العربية", "Español", "Português", "Français", "Deutsch", "日本語", "한국어", "中文"];

  return (
    <div 
      style={{ 
        width: 390, 
        minHeight: 844, 
        overflow: "auto",
        fontFamily: "'Inter', sans-serif",
        backgroundColor: "#f8f8f8",
        color: "#111111"
      }}
      className="relative flex flex-col"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        
        /* Custom scrollbar hiding */
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .hide-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* Header */}
      <div className="flex items-center px-4 py-6 bg-[#f8f8f8] sticky top-0 z-10 border-b border-[#e0e0e0]">
        <button className="p-2 -ml-2 mr-2 text-[#111111] active:opacity-50 transition-opacity">
          <ChevronLeft size={24} strokeWidth={1.5} />
        </button>
        <h1 className="text-[17px] font-semibold tracking-tight">Settings</h1>
      </div>

      <div className="flex-1 px-4 py-6 space-y-8">
        
        {/* APPEARANCE */}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-3 ml-1">Appearance</h2>
          <div className="bg-[#ffffff] border border-[#e0e0e0] rounded-xl overflow-hidden">
            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-[#e0e0e0] flex items-center justify-center">
                  <Monitor size={16} strokeWidth={1.5} className="text-[#111111]" />
                </div>
                <span className="text-[15px] font-medium">Theme</span>
              </div>
            </div>
            
            <div className="px-4 pb-4">
              <div className="flex bg-[#f8f8f8] border border-[#e0e0e0] p-1 rounded-lg">
                {["Auto", "Light", "Dark"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 py-1.5 text-[13px] font-medium rounded-md transition-colors ${
                      theme === t 
                        ? "bg-[#1a1a1a] text-white" 
                        : "text-[#888888] hover:text-[#111111]"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* READER */}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-3 ml-1">Reader</h2>
          <div className="bg-[#ffffff] border border-[#e0e0e0] rounded-xl overflow-hidden flex flex-col">
            
            <div className="p-4 border-b border-[#e0e0e0] flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-[#e0e0e0] flex items-center justify-center">
                  <BookOpen size={16} strokeWidth={1.5} className="text-[#111111]" />
                </div>
                <span className="text-[15px] font-medium">Reading Mode</span>
              </div>
              <div className="flex gap-2">
                {["Vertical", "Horizontal"].map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setReadingMode(mode)}
                    className={`flex-1 py-2 text-[13px] font-medium rounded-lg border transition-all ${
                      readingMode === mode
                        ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                        : "border-[#e0e0e0] text-[#888888] bg-transparent"
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-[#e0e0e0] flex items-center justify-center">
                  <FileText size={16} strokeWidth={1.5} className="text-[#111111]" />
                </div>
                <span className="text-[15px] font-medium">Show Page Number</span>
              </div>
              
              {/* Custom Switch */}
              <button 
                onClick={() => setShowPageNumber(!showPageNumber)}
                className={`w-11 h-6 rounded-full p-1 transition-colors relative flex items-center ${
                  showPageNumber ? "bg-[#1a1a1a]" : "bg-[#e0e0e0]"
                }`}
              >
                <div 
                  className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    showPageNumber ? "translate-x-5" : "translate-x-0"
                  }`} 
                />
              </button>
            </div>
            
          </div>
        </section>

        {/* DATA & PERFORMANCE */}
        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-3 ml-1">Data & Performance</h2>
          <div className="bg-[#ffffff] border border-[#e0e0e0] rounded-xl overflow-hidden flex flex-col">
            
            <div className="p-4 border-b border-[#e0e0e0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-[#e0e0e0] flex items-center justify-center">
                  <Zap size={16} strokeWidth={1.5} className="text-[#111111]" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[15px] font-medium">Data Saver</span>
                  <span className="text-[12px] text-[#888888] mt-0.5">Compress images on mobile network</span>
                </div>
              </div>
              
              <button 
                onClick={() => setDataSaver(!dataSaver)}
                className={`w-11 h-6 rounded-full p-1 transition-colors relative flex items-center shrink-0 ${
                  dataSaver ? "bg-[#1a1a1a]" : "bg-[#e0e0e0]"
                }`}
              >
                <div 
                  className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                    dataSaver ? "translate-x-5" : "translate-x-0"
                  }`} 
                />
              </button>
            </div>

            <button className="p-4 flex items-center justify-between active:bg-[#f8f8f8] transition-colors text-left w-full">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-[#e0e0e0] flex items-center justify-center">
                  <Database size={16} strokeWidth={1.5} className="text-[#111111]" />
                </div>
                <span className="text-[15px] font-medium">Translation Cache</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-[#888888]">142 MB</span>
                <ChevronRight size={16} strokeWidth={1.5} className="text-[#aaaaaa]" />
              </div>
            </button>
            
          </div>
        </section>

        {/* AI TRANSLATION */}
        <section className="pb-8">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#aaaaaa] mb-3 ml-1">AI Translation</h2>
          <div className="bg-[#ffffff] border border-[#e0e0e0] rounded-xl overflow-hidden flex flex-col">
            
            <div className="p-4 border-b border-[#e0e0e0] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded border border-[#e0e0e0] flex items-center justify-center">
                  <Globe size={16} strokeWidth={1.5} className="text-[#111111]" />
                </div>
                <span className="text-[15px] font-medium">Target Language</span>
              </div>
              <span className="text-[13px] text-[#888888]">{targetLanguage}</span>
            </div>
            
            <div className="p-4">
              <div className="flex flex-wrap gap-2">
                {languages.map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setTargetLanguage(lang)}
                    className={`px-3 py-1.5 text-[13px] font-medium rounded-full border transition-all ${
                      targetLanguage === lang
                        ? "border-[#1a1a1a] bg-[#1a1a1a] text-white"
                        : "border-[#e0e0e0] text-[#888888] bg-transparent hover:border-[#aaaaaa]"
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
