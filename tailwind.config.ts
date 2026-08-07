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
        /** 본문은 밝게, 왼쪽 사이드바만 어둡게 */
        canvas: '#F5F7FA',   // 페이지 바탕
        surface: '#FFFFFF',  // 카드
        raised: '#F7F9FC',   // 한 단계 들어간 면 (입력창 등)

        /** 사이드바 전용 다크 팔레트 */
        sidebar: {
          DEFAULT: '#111827',
          hover: '#1B2434',
          line: '#232D3E',
          text: '#94A3B8',
          bright: '#F2F5F9',
        },

        brand: {
          DEFAULT: '#F26522',
          50: '#FFF4EE',
          100: '#FFE6D8',
          200: '#FFC9AC',
          300: '#FFA478',
          400: '#FA8148',
          500: '#F26522',
          600: '#D9530F',
          700: '#A93D0C',
          800: '#7C2D09',
          900: '#5A2107',
        },

        /** 보조 강조색 — 그래프·긍정 신호 */
        accent: {
          DEFAULT: '#0FB5AB',
          50: '#E6FAF8',
          100: '#C6F3EF',
          500: '#0FB5AB',
          600: '#0C948C',
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
