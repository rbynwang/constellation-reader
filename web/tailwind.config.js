/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#000000",
        "void-panel": "#0A0A0A",
        star: "#F5F0E6",
        secondary: "#B8B0A4",
        glow: "#E8B547",
        "glow-bright": "#F5C842",
        accent: "#9CBCD4",
      },
      fontFamily: {
        sans: ['"Switzer"', "system-ui", "sans-serif"],
        serif: ['"Source Serif 4"', '"Source Serif Pro"', "Georgia", "serif"],
        mono: ['"Geist Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
