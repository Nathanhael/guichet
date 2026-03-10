import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { io } from 'socket.io-client';
import { 
  Send, 
  User, 
  Settings, 
  Languages, 
  Zap, 
  Eye, 
  Moon, 
  Sun,
  HandMetal
} from 'lucide-react';
import { useChatStore, Language, Theme } from '../store/useChatStore';
import BionicText from './BionicText';

const ChatLayout: React.FC = () => {
  const { 
    language, 
    setLanguage, 
    translations, 
    messages, 
    addMessage, 
    isTyping, 
    setIsTyping,
    theme,
    setTheme,
    isDyslexicMode,
    toggleDyslexicMode
  } = useChatStore();

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = translations[language];

  // Socket Logic & Simulation
  useEffect(() => {
    // Attempt real connection
    const socket = io('http://localhost:3001');
    
    socket.on('message:new', (msg) => {
      addMessage({
        id: Math.random().toString(36).substr(2, 9),
        text: msg.text,
        sender: 'agent',
        timestamp: Date.now()
      });
    });

    // Mock stimulation for prototype as requested
    const interval = setInterval(() => {
      if (!isTyping) {
        setIsTyping(true);
        setTimeout(() => {
          setIsTyping(false);
          addMessage({
            id: Math.random().toString(36).substr(2, 9),
            text: "This is a simulated agent message to test cognitive motion and bionic rendering.",
            sender: 'agent',
            timestamp: Date.now()
          });
        }, 3000);
      }
    }, 30000);

    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [addMessage, setIsTyping, isTyping]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    addMessage({
      id: Math.random().toString(36).substr(2, 9),
      text: input,
      sender: 'expert',
      timestamp: Date.now()
    });
    setInput('');
  };

  // Theme Class Mapping
  const getThemeClasses = () => {
    if (isDyslexicMode) return 'font-lexend leading-[1.75] bg-[#FFFBEB] text-[#1A1A1A]';
    if (theme === 'deep-atmosphere') return 'bg-[#0D1117] text-[#C9D1D9]';
    return 'bg-[#FDF6E3] text-[#586E75]';
  };

  const getBubbleClasses = (sender: 'agent' | 'expert') => {
    if (isDyslexicMode) {
      return `border-2 border-[#1A1A1A] rounded-lg p-4 ${
        sender === 'agent' ? 'bg-white' : 'bg-[#FEF3C7]'
      }`;
    }
    const glass = "backdrop-blur-md border border-white/20 shadow-lg p-4 rounded-2xl";
    if (sender === 'expert') {
      return `${glass} ${theme === 'deep-atmosphere' ? 'bg-blue-600/30' : 'bg-blue-500/20'}`;
    }
    return `${glass} ${theme === 'deep-atmosphere' ? 'bg-gray-700/40' : 'bg-white/60'}`;
  };

  return (
    <div className={`flex flex-col h-screen overflow-hidden transition-all duration-500 ${getThemeClasses()}`}>
      
      {/* Dissolving Nav */}
      <motion.header 
        animate={{ opacity: isTyping ? 0.1 : 1 }}
        className="p-4 glass-panel flex items-center justify-between z-10"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-accent-500 to-rose-500 flex items-center justify-center text-white shadow-lg">
            <HandMetal className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Solaris OS v4.2</h1>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs opacity-70 font-medium tracking-wide uppercase">{t.agentOnline}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Language Switcher */}
          <div className="flex gap-1 p-1 bg-black/5 dark:bg-white/5 rounded-lg">
            {(['en', 'nl', 'fr'] as Language[]).map((lang) => (
              <button
                key={lang}
                onClick={() => setLanguage(lang)}
                className={`px-2 py-1 text-xs font-bold rounded uppercase transition-all ${
                  language === lang 
                   ? 'bg-accent-500 text-white shadow-sm' 
                   : 'opacity-50 hover:opacity-100'
                }`}
              >
                {lang}
              </button>
            ))}
          </div>

          {/* Theme Toggles */}
          <button 
            onClick={() => setTheme(theme === 'solaris-light' ? 'deep-atmosphere' : 'solaris-light')}
            className="p-2 hover:bg-black/5 rounded-full transition-colors"
          >
            {theme === 'deep-atmosphere' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          
          <button 
            onClick={toggleDyslexicMode}
            className={`p-2 rounded-lg transition-all ${isDyslexicMode ? 'bg-accent-500 text-white' : 'hover:bg-black/5'}`}
            title="Dyslexic Mode"
          >
            <Eye className="w-5 h-5" />
          </button>
        </div>
      </motion.header>

      {/* Chat Area */}
      <main 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-thin flex flex-col pt-8"
      >
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className={`flex ${msg.sender === 'expert' ? 'justify-end' : 'justify-start'} w-full items-end gap-2`}
            >
              {msg.sender === 'agent' && (
                <div className="w-8 h-8 rounded-full bg-slate-500/20 flex-shrink-0 flex items-center justify-center">
                  <User size={16} />
                </div>
              )}
              
              <div className={`max-w-[80%] ${getBubbleClasses(msg.sender)}`}>
                <BionicText text={msg.text} className="text-sm md:text-base whitespace-pre-wrap" />
                <div className="text-[10px] mt-1 opacity-40 text-right">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {msg.sender === 'expert' && (
                <div className="w-8 h-8 rounded-full bg-accent-500/20 flex-shrink-0 flex items-center justify-center text-accent-600">
                  <Zap size={16} />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 px-2 opacity-60 italic text-sm"
          >
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span 
                  key={i} 
                  className="w-1 h-1 bg-current rounded-full" 
                  style={{ animation: `pulse 1s ease-in-out infinite ${i * 0.2}s` }}
                />
              ))}
            </span>
            {t.typing}
          </motion.div>
        )}
      </main>

      {/* Dissolving Input Bar */}
      <motion.footer 
        animate={{ opacity: isTyping ? 0.1 : 1 }}
        className="p-6 glass-panel relative z-10"
      >
        <div className="relative group">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t.placeholder}
            className={`w-full bg-black/5 dark:bg-white/5 border border-white/20 dark:border-white/5 rounded-2xl px-5 py-4 pr-16 outline-none focus:ring-2 focus:ring-accent-500/50 transition-all resize-none min-h-[64px] max-h-32 ${isDyslexicMode ? 'border-2 border-[#1A1A1A]' : ''}`}
            rows={1}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim()}
            className="absolute right-3 bottom-3 p-3 bg-accent-500 text-white rounded-xl shadow-lg hover:bg-accent-600 transition-all disabled:opacity-50 disabled:hover:bg-accent-500 active:scale-95"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </motion.footer>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
        .font-lexend { font-family: 'Lexend', sans-serif; }
      `}} />
    </div>
  );
};

export default ChatLayout;
