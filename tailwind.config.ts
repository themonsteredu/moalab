import type { Config } from 'tailwindcss';

/**
 * 다크 대시보드 팔레트.
 *
 * neutral 스케일을 통째로 뒤집었다 (50 = 가장 어두움, 900 = 가장 밝음).
 * 화면 코드가 이미 `text-neutral-900`(본문) / `bg-neutral-50`(옅은 배경) 처럼
 * 라이트 기준으로 쓰여 있어서, 스케일만 뒤집으면 400곳 넘는 클래스를
 * 손대지 않고 그대로 다크로 돌아간다.
 *
 * 상태 색(green/red/...)도 50·100 은 어두운 틴트, 700·800 은 밝은 글자색으로
 * 맞춰서 `bg-red-100 text-red-700` 같은 기존 칩 조합이 그대로 읽히게 했다.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 페이지·카드 표면
        canvas: '#0C111B',
        surface: '#151C29',
        raised: '#1C2534',

        neutral: {
          50: '#111827', // 가장 옅은 '배경' 자리 → 살짝 밝은 패널
          100: '#1A2231', // 칩 배경
          200: '#232D3E', // 트랙 / 구분 면
          300: '#313D52', // 테두리 · 아주 흐린 글자
          400: '#6E7D93', // 흐린 글자
          500: '#94A3B8', // 보조 글자
          600: '#AEBAC9',
          700: '#C7D1DD',
          800: '#DEE5EC',
          900: '#F2F5F9', // 본문 글자
        },

        brand: {
          DEFAULT: '#F26522',
          50: '#2A1710',
          100: '#3A1E13',
          200: '#5A2E18',
          300: '#8A4620',
          400: '#C25526',
          500: '#F26522',
          600: '#FF7A3D',
          700: '#FF9A63',
          800: '#FFB88C',
          900: '#FFD4B8',
        },

        /** 보조 강조색 — 그래프·긍정 신호 */
        accent: {
          DEFAULT: '#2AD1C8',
          50: '#0C2A2C',
          100: '#103A3C',
          500: '#2AD1C8',
          600: '#4FE0D8',
        },

        green: {
          50: '#0D2A1C',
          100: '#12351F',
          400: '#4ADE80',
          500: '#22C55E',
          600: '#16A34A',
          700: '#5CE68F',
          800: '#86EFAC',
        },
        red: {
          50: '#2E1418',
          100: '#3B171C',
          200: '#5A2028',
          300: '#7A2A34',
          400: '#F87171',
          500: '#EF4444',
          600: '#F26060',
          700: '#FF8A8A',
          800: '#FFA9A9',
        },
        blue: {
          50: '#0E2036',
          100: '#132A45',
          400: '#60A5FA',
          500: '#3B82F6',
          600: '#6BA6FF',
          700: '#8CBBFF',
        },
        yellow: {
          50: '#2C2410',
          100: '#392E13',
          800: '#F5C86B',
          900: '#FFDD9B',
        },
        orange: {
          50: '#2C1A0E',
          100: '#3A2212',
          200: '#5A3318',
          600: '#FB923C',
          700: '#FDB574',
        },
        purple: {
          50: '#231436',
          600: '#C084FC',
        },
        amber: { 300: '#FCD34D' },
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
        grow: {
          from: { transform: 'scaleY(0)' },
          to: { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'slide-up': 'slide-up .18s ease-out',
        'fade-up': 'fade-up .35s cubic-bezier(.22,1,.36,1) both',
        shake: 'shake .4s ease-in-out',
        pop: 'pop .16s cubic-bezier(.34,1.56,.64,1)',
        grow: 'grow .5s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
