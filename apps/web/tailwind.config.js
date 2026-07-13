/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#0F0F11",
          panel: "#17181B",
          raised: "#1F2024",
          border: "#2A2B30",
        },
        amber: {
          DEFAULT: "#E8A33D",
          bright: "#F5B959",
          dim: "#8A6329",
        },
        teal: {
          DEFAULT: "#4FD1C5",
          dim: "#2E8079",
        },
      },
      fontFamily: {
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
    },
  },
  plugins: [],
}
