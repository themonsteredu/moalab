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
      },
      animation: {
        'slide-up': 'slide-up .18s ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
