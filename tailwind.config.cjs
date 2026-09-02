/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx,js,jsx}',
    './pages/**/*.{ts,tsx,js,jsx}',
    './services/**/*.{ts,tsx,js,jsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Tajawal', 'sans-serif'],
        serif: ['Amiri', 'serif'],
      },
      colors: {
        dark: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
        primary: {
          50: 'rgb(var(--color-primary-50, 236 254 255) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100, 207 250 254) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200, 165 243 252) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300, 103 232 249) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400, 34 211 238) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500, 6 182 212) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600, 8 145 178) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700, 14 116 144) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800, 21 94 117) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900, 22 78 99) / <alpha-value>)',
          950: 'rgb(var(--color-primary-950, 8 51 68) / <alpha-value>)',
        },
        secondary: {
          50: 'rgb(var(--color-secondary-50, 239 246 255) / <alpha-value>)',
          100: 'rgb(var(--color-secondary-100, 219 234 254) / <alpha-value>)',
          200: 'rgb(var(--color-secondary-200, 191 219 254) / <alpha-value>)',
          300: 'rgb(var(--color-secondary-300, 147 197 253) / <alpha-value>)',
          400: 'rgb(var(--color-secondary-400, 96 165 250) / <alpha-value>)',
          500: 'rgb(var(--color-secondary-500, 37 99 235) / <alpha-value>)',
          600: 'rgb(var(--color-secondary-600, 29 78 216) / <alpha-value>)',
          700: 'rgb(var(--color-secondary-700, 29 78 216) / <alpha-value>)',
          800: 'rgb(var(--color-secondary-800, 30 64 175) / <alpha-value>)',
          900: 'rgb(var(--color-secondary-900, 30 58 138) / <alpha-value>)',
          950: 'rgb(var(--color-secondary-950, 23 37 84) / <alpha-value>)',
        },
      },
      animation: {
        blob: 'blob 8s ease-in-out infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        glow: 'glow 2s ease-in-out infinite alternate',
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        blob: {
          '0%, 100%': { transform: 'translate(0px, 0px) scale(1)' },
          '25%': { transform: 'translate(30px, -50px) scale(1.1)' },
          '50%': { transform: 'translate(-20px, 30px) scale(0.95)' },
          '75%': { transform: 'translate(-30px, -20px) scale(1.05)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgb(var(--color-primary-500, 6 182 212) / 0.3)' },
          '100%': { boxShadow: '0 0 40px rgb(var(--color-primary-500, 6 182 212) / 0.6)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      boxShadow: {
        neon: '0 0 20px rgb(var(--color-primary-500, 6 182 212) / 0.4)',
        'neon-lg': '0 0 40px rgb(var(--color-primary-500, 6 182 212) / 0.5)',
      },
    },
  },
  plugins: [],
};
