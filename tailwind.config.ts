import type { Config } from 'tailwindcss';

/**
 * 리니어(Linear) 계열 다크 팔레트.
 *
 * **화면 코드를 고치지 않고 통째로 다크로 돌리는 방법** — `neutral` 스케일을
 * 뒤집는다 (50 = 가장 어두움, 900 = 가장 밝음). 화면 1,454곳이 이미
 * `text-neutral-900`(본문) / `bg-neutral-50`(옅은 배경) 처럼 **라이트 기준**으로
 * 쓰여 있어서, 스케일만 뒤집으면 그 클래스들이 전부 그대로 다크로 읽힌다.
 *
 * 상태 색(green/red/amber/blue/violet)도 같은 규칙이다 —
 * **50·100 은 어두운 틴트, 700·800 은 밝은 글자색**. 그래야 기존
 * `bg-red-100 text-red-700` 같은 칩 조합이 손대지 않고 그대로 읽힌다.
 *
 * 리니어에서 가져온 것은 색조가 아니라 **절제**다:
 * 거의 무채색 · 1px 실선 테두리 · 그림자 없음 · 작은 모서리 ·
 * 색은 상태에만. 브랜드 주황은 그대로 두되 **꽉 채우는 자리를 최소로** 남긴다.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /** 리니어는 모서리가 얕다. 여기서 한 번 줄이면 292곳이 같이 따라온다 */
      borderRadius: {
        md: '5px',
        lg: '6px',
        xl: '8px',
        '2xl': '10px',
        '3xl': '14px',
      },
      colors: {
        /**
         * 바탕 → 카드 → 한 단계 뜬 면. 셋 다 거의 검정이고 차이는 아주 작다.
         *
         * ⚠️ **값을 여기 박지 않고 CSS 변수로 받는다** (`globals.css` 의 `:root`).
         * 그래야 **인쇄할 때 변수만 밝은 값으로 되돌려** 흰 종이에 검은 글씨가 나온다 —
         * 안 그러면 인쇄 화면 여섯 개가 전부 흰 종이에 흰 글씨가 된다.
         */
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',

        /**
         * ⚠️ **뒤집힌 스케일이다.** 50 이 가장 어둡고 900 이 가장 밝다.
         * 화면 코드는 라이트 기준 그대로 쓰면 된다.
         */
        neutral: {
          50: 'rgb(var(--n-50) / <alpha-value>)',
          100: 'rgb(var(--n-100) / <alpha-value>)',
          200: 'rgb(var(--n-200) / <alpha-value>)',
          300: 'rgb(var(--n-300) / <alpha-value>)',
          400: 'rgb(var(--n-400) / <alpha-value>)',
          500: 'rgb(var(--n-500) / <alpha-value>)',
          600: 'rgb(var(--n-600) / <alpha-value>)',
          700: 'rgb(var(--n-700) / <alpha-value>)',
          800: 'rgb(var(--n-800) / <alpha-value>)',
          900: 'rgb(var(--n-900) / <alpha-value>)',
        },

        /** 사이드바는 바탕과 같은 층이다 (리니어처럼 경계를 세우지 않는다) */
        sidebar: {
          DEFAULT: '#0A0B0C',
          hover: '#17181B',
          line: '#1C1D21',
          text: '#8F949C',
          bright: '#F2F3F5',
        },

        /** 브랜드 주황 — 어두운 바탕에 맞춰 틴트를 어둡게, 글자를 밝게 */
        brand: {
          DEFAULT: '#F26522',
          50: '#241209',
          100: '#33180B',
          200: '#4A2210',
          300: '#6E3315',
          400: '#A94D1C',
          500: '#F26522',
          600: '#FF7A3D',
          700: '#FF9A67',
          800: '#FFB894',
          900: '#FFD6C2',
        },

        accent: {
          DEFAULT: '#0FB5AB',
          50: '#052220',
          100: '#07322F',
          500: '#0FB5AB',
          600: '#2ED3C8',
        },

        /* ── 상태 색 — 전부 같은 규칙(50·100 어둡게 / 700·800 밝게) ───────── */
        green: {
          50: '#0A1C15', 100: '#0E281E', 200: '#153B2B', 300: '#1E523C',
          400: '#2A7154', 500: '#38916C', 600: '#4CA983', 700: '#78C3A3',
          800: '#A9DAC4', 900: '#D3EDE1',
        },
        red: {
          50: '#21100F', 100: '#2E1614', 200: '#431E1B', 300: '#5E2B26',
          400: '#853E36', 500: '#B0554A', 600: '#C86F63', 700: '#DE9188',
          800: '#EDB8B2', 900: '#F7DBD8',
        },
        amber: {
          50: '#1F1707', 100: '#2C210A', 200: '#402F0E', 300: '#5B4415',
          400: '#80601F', 500: '#A9812C', 600: '#C39B47', 700: '#D7BA74',
          800: '#EAD6A6', 900: '#F6EBD3',
        },
        blue: {
          50: '#0C1626', 100: '#111F36', 200: '#182D4D', 300: '#22406C',
          400: '#305B96', 500: '#4381CC', 600: '#5E9BE4', 700: '#8CBAF0',
          800: '#B9D5F7', 900: '#DCEAFB',
        },
        violet: {
          50: '#16132A', 100: '#1E1A3B', 200: '#2A2454', 300: '#3B3275',
          400: '#5246A2', 500: '#6E60D6', 600: '#8B7DE8', 700: '#A99EF0',
          800: '#C8C1F6', 900: '#E4E0FB',
        },
      },
      /**
       * ⚠️ **굵기 값을 낮춰 잡았다.** 화면 코드의 `font-black`(62곳)·`font-bold`(394곳)을
       * 하나씩 고치지 않고 여기서 한 단계씩 내린다. 리니어는 굵기로 소리치지 않는다 —
       * 위계는 굵기가 아니라 **밝기(neutral-900 vs 500)** 로 준다.
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
