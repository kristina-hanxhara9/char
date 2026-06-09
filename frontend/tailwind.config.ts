import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // YOPEY brand palette — sRGB equivalents of the brand-book CMYK values.
        // Theme is YELLOW-DOMINANT: yellow chrome + purple anchors.
        yopey: {
          // Purple — CMYK C54 M100 Y0 K46. Used for primary CTAs, key links,
          // and brand identifier text. White text on this passes AAA (14.9:1).
          primary: "#3F008A",
          primaryDark: "#2D0061",      // hover/pressed
          primaryLight: "#EFE5F8",     // light tints (form borders, hover backgrounds)
          // Yellow — CMYK C0 M32 Y100 K0. Dominant chrome colour: header bands,
          // stat circles, callout backgrounds, badges. Pair with BLACK or
          // PURPLE text — never white (1.9:1 fails WCAG).
          accent: "#FFAD00",
          accentDark: "#D99100",       // hover on yellow buttons
          accentLight: "#FFF4D6",      // very soft yellow for highlight bands + soft cards
          // Black — corporate 100% K
          ink: "#000000",
          inkSoft: "#1f2937",          // softer for body text
          bg: "#FFFBF0",               // very subtle warm cream — neutral but yellow-leaning
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
