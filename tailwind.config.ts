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
      /**
       * 리니어(Linear) 를 참고해 **모서리를 얕게** 다시 잡았다.
       * 여기서 한 번 줄이면 화면 292곳이 같이 따라온다 — 클래스는 안 고친다.
       */
      borderRadius: {
        md: '5px',
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '14px',
      },
      /**
       * **굵기도 한 단계씩 낮춰 잡았다.** 화면의 `font-black`(62곳)·`font-bold`(394곳)을
       * 하나씩 고치지 않고 값만 내린다. 리니어는 굵기로 소리치지 않는다 —
       * 위계는 굵기가 아니라 **밝기 차이**로 준다.
       * 폰트는 400·600·700·900 네 벌만 받으므로 그 안에서만 고른다
       * (굵기를 늘리면 한글 폰트가 굵기당 1.5MB 씩 더 내려온다).
       */
      fontWeight: {
        normal: '400',
        medium: '400',
        semibold: '600',
        bold: '600',
        extrabold: '700',
        black: '700',
      },
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
        'slide-up': 'slide-up .14s cubic-bezier(.32,.72,0,1)',
        'fade-up': 'fade-up .2s cubic-bezier(.32,.72,0,1) both',
        shake: 'shake .4s ease-in-out',
        pop: 'pop .12s cubic-bezier(.32,.72,0,1)',
        grow: 'grow .5s cubic-bezier(.22,1,.36,1) both',
      },
    },
  },
  plugins: [],
};

export default config;
