import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // YOPEY corporate palette — sRGB equivalents of brand CMYK
        yopey: {
          // Purple — CMYK C54 M100 Y0 K46
          primary: "#3F008A",
          primaryDark: "#2D0061",      // hover/pressed state, deeper purple
          primaryLight: "#EFE5F8",     // soft tinted background for cards/highlights
          // Yellow — CMYK C0 M32 Y100 K0. WARNING: too light for white text.
          // Use as background with BLACK text, or as accent fill (badges, dots).
          accent: "#FFAD00",
          accentDark: "#D99100",       // hover on yellow buttons
          accentLight: "#FFF4D6",      // soft yellow background for highlight bands
          // Black — corporate 100% K
          ink: "#000000",
          inkSoft: "#1f2937",          // for body text where pure black is too harsh
          bg: "#FAF7FE",               // very light purple tint — body background
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
