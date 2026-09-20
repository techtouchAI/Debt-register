/** @type {import('tailwindcss').Config} */

/**
 * لوحة ألوان "فخمة" محايدة: أساس جرافيت/عاجي دافئ مع لمسة برونزية خافتة.
 * الأعِنة الدلالية (نجاح/تحذير/خطر/معلومة) درجات مكتومة غير صارخة.
 */
const bronze = {
  50: '#faf8f4',
  100: '#f1ece1',
  200: '#e2d6bf',
  300: '#cfba97',
  400: '#bda176',
  500: '#ab8b5d',
  600: '#8f7048',
  700: '#73593b',
  800: '#5f4a33',
  900: '#513f2e',
  950: '#2e2218'
}

const sage = {
  50: '#f5f7f2',
  100: '#e7ebe0',
  200: '#cfd9c2',
  300: '#adbf9a',
  400: '#89a172',
  500: '#6a8553',
  600: '#536a40',
  700: '#435536',
  800: '#37452e',
  900: '#2f3b29',
  950: '#171f14'
}

const oxblood = {
  50: '#faf5f4',
  100: '#f3e8e5',
  200: '#e6cfc9',
  300: '#d3aea4',
  400: '#bc8778',
  500: '#a66a5a',
  600: '#8c5346',
  700: '#72433a',
  800: '#5f3a33',
  900: '#51332e',
  950: '#2b1916'
}

const sand = {
  50: '#faf7f0',
  100: '#f2ecdd',
  200: '#e3d4b6',
  300: '#d0b88c',
  400: '#bfa06b',
  500: '#b18d58',
  600: '#9a7549',
  700: '#7c5c3c',
  800: '#654b34',
  900: '#56402e',
  950: '#2f2117'
}

const steel = {
  50: '#f4f6f7',
  100: '#e8eced',
  200: '#d1d9dc',
  300: '#adbcc1',
  400: '#8399a1',
  500: '#667e88',
  600: '#536873',
  700: '#45565f',
  800: '#3b4951',
  900: '#343e45',
  950: '#22292e'
}

// أساس دافئ (عاجي ↔ جرافيت) بدل الرمادي البارد
const graphite = {
  50: '#f8f7f5',
  100: '#f0eeea',
  200: '#e2dfda',
  300: '#cfcbc3',
  400: '#a9a49b',
  500: '#868178',
  600: '#6c675f',
  700: '#57534c',
  800: '#3a3833',
  900: '#242220',
  950: '#151412'
}

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        'cairo': ['Cairo', 'sans-serif'],
        'tajawal': ['Tajawal', 'sans-serif']
      },
      colors: {
        // اللون الأساسي: برونزي مكتوم (يعمل مع نص أبيض في الدرجات 600+)
        primary: bronze,
        // إعادة تعريف الأعِنّة الافتراضية لتصبح مكتومة وفاخرة
        gray: graphite,
        green: sage,
        emerald: sage,
        red: oxblood,
        amber: sand,
        yellow: sand,
        blue: steel,
        indigo: steel,
        purple: steel,
        bronze,
        boxShadow: {
          card: '0 1px 2px 0 rgb(21 20 18 / 0.05), 0 8px 24px -12px rgb(21 20 18 / 0.12)',
          'card-dark': '0 1px 2px 0 rgb(0 0 0 / 0.4), 0 8px 24px -12px rgb(0 0 0 / 0.5)'
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite'
      }
    },
  },
  plugins: [],
}
