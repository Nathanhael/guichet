import React from 'react';
import { motion } from 'framer-motion';

interface UserAvatarProps {
  userId: string;
  name: string;
  avatarUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showStatus?: boolean;
  isOnline?: boolean;
  ringColor?: string;
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
};

const COLORS = [
  'bg-rose-500', 'bg-pink-500', 'bg-fuchsia-500', 'bg-purple-500', 
  'bg-violet-500', 'bg-indigo-500', 'bg-blue-500', 'bg-sky-500', 
  'bg-cyan-500', 'bg-teal-500', 'bg-emerald-500', 'bg-green-500', 
  'bg-amber-500', 'bg-orange-500'
];

function getInitials(name: string) {
  if (!name) return '?';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getColorForUser(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function UserAvatar({ 
  userId, 
  name, 
  avatarUrl, 
  size = 'md', 
  showStatus = false, 
  isOnline = false,
  ringColor
}: UserAvatarProps) {
  const initials = getInitials(name);
  const bgColor = getColorForUser(userId);
  const sizeClass = SIZE_MAP[size];

  return (
    <div className={`relative shrink-0 ${sizeClass}`}>
      <motion.div 
        whileHover={{ scale: 1.05 }}
        className={`w-full h-full rounded-full flex items-center justify-center font-bold text-white shadow-sm overflow-hidden border-2 border-white dark:border-brand-900 ${!avatarUrl ? bgColor : ''}`}
        style={ringColor ? { borderColor: ringColor } : {}}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          initials
        )}
      </motion.div>
      
      {showStatus && (
        <span 
          className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-brand-900 transition-colors duration-300 ${
            isOnline ? 'bg-green-500' : 'bg-gray-400'
          }`} 
        />
      )}
    </div>
  );
}
