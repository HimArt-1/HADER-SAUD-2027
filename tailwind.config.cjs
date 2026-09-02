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
          50: 'rgb(var(--color-primary-50, 240 249 247) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100, 218 240 236) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200, 177 221 214) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300, 125 198 189) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400, 69 171 161) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500, 43 156 146) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600, 10 85 93) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700, 8 70 77) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800, 7 58 64) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900, 6 47 53) / <alpha-value>)',
          950: 'rgb(var(--color-primary-950, 4 31 35) / <alpha-value>)',
        },
        secondary: {
          50: 'rgb(var(--color-secondary-50, 241 250 248) / <alpha-value>)',
          100: 'rgb(var(--color-secondary-100, 220 243 238) / <alpha-value>)',
          200: 'rgb(var(--color-secondary-200, 180 226 217) / <alpha-value>)',
          300: 'rgb(var(--color-secondary-300, 135 207 195) / <alpha-value>)',
          400: 'rgb(var(--color-secondary-400, 84 188 169) / <alpha-value>)',
          500: 'rgb(var(--color-secondary-500, 19 114 122) / <alpha-value>)',
          600: 'rgb(var(--color-secondary-600, 6 47 53) / <alpha-value>)',
          700: 'rgb(var(--color-secondary-700, 5 39 44) / <alpha-value>)',
          800: 'rgb(var(--color-secondary-800, 4 32 36) / <alpha-value>)',
          900: 'rgb(var(--color-secondary-900, 3 25 29) / <alpha-value>)',
          950: 'rgb(var(--color-secondary-950, 2 17 20) / <alpha-value>)',
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
          '0%': { boxShadow: '0 0 20px rgb(var(--color-primary-500, 43 156 146) / 0.2)' },
          '100%': { boxShadow: '0 0 40px rgb(var(--color-primary-500, 43 156 146) / 0.35)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
      boxShadow: {
        neon: '0 12px 32px rgb(var(--color-primary-600, 10 85 93) / 0.22)',
        'neon-lg': '0 20px 54px rgb(var(--color-primary-600, 10 85 93) / 0.28)',
      },
    },
  },
  plugins: [],
};
