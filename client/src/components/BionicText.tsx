import React, { useMemo } from 'react';
import { useChatStore } from '../store/useChatStore';

interface BionicTextProps {
  text: string;
  className?: string;
}

const BionicText: React.FC<BionicTextProps> = ({ text, className = '' }) => {
  const language = useChatStore((state) => state.language);

  const bionicContent = useMemo(() => {
    // Split by spaces but preserve them
    const words = text.split(/(\s+)/);
    
    return words.map((word, idx) => {
      if (word.trim().length === 0) return word;

      // Density calculation based on language (2026 Neuro-inclusive standard)
      let fixationLength: number;
      
      const len = word.length;
      if (language === 'fr') {
        // French: Higher density for fixation (fixation on syllables)
        fixationLength = Math.ceil(len * 0.6);
      } else if (language === 'nl') {
        // Dutch: Compound word aware fixation
        // Heuristic: if word is long (>10 chars), it's likely compound, bold more
        fixationLength = len > 10 ? Math.ceil(len * 0.55) : Math.ceil(len * 0.45);
      } else {
        // English: Standard 45% fixation
        fixationLength = Math.ceil(len * 0.45);
      }

      // Ensure at least 1 char is bolded
      if (fixationLength === 0 && len > 0) fixationLength = 1;

      const fixation = word.slice(0, fixationLength);
      const rest = word.slice(fixationLength);

      return (
        <React.Fragment key={idx}>
          <span className="font-bold">{fixation}</span>
          <span>{rest}</span>
        </React.Fragment>
      );
    });
  }, [text, language]);

  return <span className={className}>{bionicContent}</span>;
};

export default BionicText;
