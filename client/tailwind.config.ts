import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  safelist: [
    {
      pattern: /(bg|text|border|shadow)-(rose|blue|amber|emerald|purple|indigo|cyan|orange|teal|pink)-(400|500|600|700)/,
    },
    {
      pattern: /bg-(rose|blue|amber|emerald|purple|indigo|cyan|orange|teal|pink)-500\/10/,
    },
    {
      pattern: /shadow-(rose|blue|amber|emerald|purple|indigo|cyan|orange|teal|pink)-500\/40/,
    },
    {
      pattern: /border-(rose|blue|amber|emerald|purple|indigo|cyan|orange|teal|pink)-500\/20/,
    },
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        lexend: ['Lexend', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#f1f6fa',
          100: '#e3ebf4',
          200: '#c2d2e3',
          300: '#9bb1c9',
          400: '#758fae',
          500: '#557091',
          600: '#3f5675',
          700: '#2d3f56',
          800: '#1e2b38', // iKanbi Navy
          900: '#121b25',
        },
        accent: {
          400: '#f07469',
          500: '#e65649', // iKanbi Coral
          600: '#cc4135',
        },
        solarized: {
          base03: '#002b36',
          base02: '#073642',
          base01: '#586e75',
          base00: '#657b83',
          base0: '#839496',
          base1: '#93a1a1',
          base2: '#eee8d5',
          base3: '#fdf6e3',
          yellow: '#b58900',
          orange: '#cb4b16',
          red: '#dc322f',
          magenta: '#d33682',
          violet: '#6c71c4',
          blue: '#268bd2',
          cyan: '#2aa198',
          green: '#859900',
        }
      },
      boxShadow: {
        'soft': '0 4px 40px rgba(0, 0, 0, 0.05)',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        }
      }
    },
  },
  plugins: [],
} satisfies Config;
