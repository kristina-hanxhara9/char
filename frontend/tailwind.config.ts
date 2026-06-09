import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // YOPEY brand palette — STRICT two-colour. The brand book lists only
        // these two values; we don't manufacture lighter/darker variants.
        // For tints: use Tailwind opacity modifiers (e.g. bg-yopey-accent/15).
        // For hovers: use hover:opacity-90 instead of a darker shade.
        yopey: {
          // Purple — CMYK C54 M100 Y0 K46
          primary: "#3F008A",
          // Yellow — CMYK C0 M32 Y100 K0
          accent: "#FFAD00",
          // Text only (not brand colours; standard for legibility)
          ink: "#000000",          // headings
          inkSoft: "#1f2937",      // body text — pure black is harsh at 14-16px
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
