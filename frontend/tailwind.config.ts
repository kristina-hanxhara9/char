import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // YOPEY warm/friendly palette
        yopey: {
          primary: "#7c3aed",       // purple-600
          primaryDark: "#6d28d9",   // purple-700
          accent: "#f97316",        // orange-500
          bg: "#fdf4ff",            // soft lavender background
          ink: "#1f2937",
        },
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      animation: {
        "bounce-slow": "bounce 1.4s infinite",
        "fade-in": "fadeIn 0.3s ease-in",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
