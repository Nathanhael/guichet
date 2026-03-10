import { create } from 'zustand';

export type Language = 'en' | 'nl' | 'fr';
export type Theme = 'solaris-light' | 'deep-atmosphere';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'agent';
  timestamp: Date;
}

const mockConfig = {
  preferredLanguage: 'en' as Language, // This could be 'nl' or 'fr'
};

export const translations = {
  en: {
    send: 'Send',
    agentOnline: 'Agent Online',
    placeholder: 'Type a message...',
    dyslexicMode: 'Dyslexic Mode',
    theme: 'Theme',
    typing: 'Agent is typing...',
  },
  nl: {
    send: 'Verzenden',
    agentOnline: 'Agent Online',
    placeholder: 'Typ een bericht...',
    dyslexicMode: 'Dyslexiemodus',
    theme: 'Thema',
    typing: 'Agent is aan het typen...',
  },
  fr: {
    send: 'Envoyer',
    agentOnline: 'Agent en ligne',
    placeholder: 'Tapez un message...',
    dyslexicMode: 'Mode dyslexique',
    theme: 'Thème',
    typing: 'Agent écrit...',
  },
};

interface ChatState {
  messages: Message[];
  language: Language;
  theme: Theme;
  dyslexicMode: boolean;
  isTyping: boolean;
  
  // Actions
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  setLanguage: (lang: Language) => void;
  setTheme: (theme: Theme) => void;
  toggleDyslexicMode: () => void;
  setTyping: (isTyping: boolean) => void;
  
  // Helpers
  t: (key: keyof typeof translations['en']) => string;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [
    {
      id: '1',
      text: 'Hello! Welcome to Solaris OS. How can I assist you today?',
      sender: 'agent',
      timestamp: new Date(),
    },
  ],
  language: mockConfig.preferredLanguage,
  theme: 'solaris-light',
  dyslexicMode: false,
  isTyping: false,

  addMessage: (msg) => set((state) => ({
    messages: [
      ...state.messages,
      {
        ...msg,
        id: Math.random().toString(36).substring(7),
        timestamp: new Date(),
      },
    ],
  })),

  setLanguage: (language) => set({ language }),
  setTheme: (theme) => set({ theme }),
  toggleDyslexicMode: () => set((state) => ({ dyslexicMode: !state.dyslexicMode })),
  setTyping: (isTyping) => set({ isTyping }),

  t: (key) => {
    const { language } = get();
    return translations[language][key] || key;
  },
}));
