import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#F26522',
          50: '#FFF4EE',
          100: '#FFE6D8',
          200: '#FFC9AC',
          300: '#FFA478',
          400: '#FA8148',
          500: '#F26522',
          600: '#D64F10',
          700: '#A93D0C',
          800: '#7C2D09',
          900: '#5A2107',
        },
      },
      fontFamily: {
        sans: [
          '"S-Core Dream"',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          '"Apple SD Gothic Neo"',
          '"Noto Sans KR"',
          '"Malgun Gothic"',
          'sans-serif',
        ],
      },
      keyframes: {
        'slide-up': {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-up': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
        shake: {
          '0%,100%': { transform: 'translateX(0)' },
          '20%,60%': { transform: 'translateX(-7px)' },
          '40%,80%': { transform: 'translateX(7px)' },
        },
        pop: {
          from: { transform: 'scale(.7)', opacity: '.4' },
          to: { transform: 'scale(1)', opacity: '1' },
        },
      },
      animation: {
        'slide-up': 'slide-up .18s ease-out',
        'fade-up': 'fade-up .35s cubic-bezier(.22,1,.36,1) both',
        shake: 'shake .4s ease-in-out',
        pop: 'pop .16s cubic-bezier(.34,1.56,.64,1)',
      },
    },
  },
  plugins: [],
};

export default config;
