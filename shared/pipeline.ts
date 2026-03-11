import { UserRole } from './types.js';

export interface MessagePipeline {
  metadata: {
    messageId: string;
    ticketId: string;
    senderId: string;
    senderRole: UserRole;
    timestamp: string;
  };
  
  stages: {
    raw: {
      text: string;
      lang: string;
    };
    
    guard: {
      ok: boolean;
      blockedCode?: string;
      sanitizedText?: string;
      originalScore?: number;
    };
    
    translation?: {
      targetLang: string;
      translatedText: string;
      provider: 'ollama' | 'fallback';
      cached: boolean;
    };
    
    final: {
      displayText: string;
      isWhisper: boolean;
      isSystem: boolean;
    };
  };
}
