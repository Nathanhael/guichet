import React from 'react';
import { motion } from 'framer-motion';

const AmbientBackground: React.FC = () => {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.4 }}
        className="absolute inset-0 bg-gradient-to-br from-brand-500/20 via-rose-500/10 to-amber-500/20 animate-gradient-slow"
      />
      
      {/* Animated Orbs */}
      <motion.div
        animate={{
          x: [0, 100, -50, 0],
          y: [0, -50, 100, 0],
          scale: [1, 1.2, 0.8, 1],
        }}
        transition={{
          duration: 20,
          repeat: Infinity,
          ease: "linear"
        }}
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-400/20 rounded-full blur-[100px]"
      />
      
      <motion.div
        animate={{
          x: [0, -150, 50, 0],
          y: [0, 100, -50, 0],
          scale: [1, 0.9, 1.3, 1],
        }}
        transition={{
          duration: 25,
          repeat: Infinity,
          ease: "linear"
        }}
        className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-rose-400/10 rounded-full blur-[120px]"
      />

      <motion.div
        animate={{
          x: [0, 80, -120, 0],
          y: [0, 150, 20, 0],
        }}
        transition={{
          duration: 18,
          repeat: Infinity,
          ease: "linear"
        }}
        className="absolute top-1/2 right-1/3 w-80 h-80 bg-amber-400/15 rounded-full blur-[80px]"
      />
    </div>
  );
};

export default AmbientBackground;
