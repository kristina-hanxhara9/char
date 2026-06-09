import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // YOPEY corporate palette — primary purple + the muted gold used on yopey.org
        yopey: {
          // Purple — matches the deep purple on yopey.org (CMYK C54 M100 Y0 K46)
          primary: "#3F008A",
          primaryDark: "#2D0061",      // hover/pressed state
          primaryLight: "#EFE5F8",     // soft tinted background for cards
          // Gold — muted dusty gold used on yopey.org's header band + "this year"
          // stat circles. NOT the bright print yellow — that reads as too loud
          // on screen and doesn't match the site.
          gold: "#C4A24C",
          goldDark: "#A88534",         // hover state on gold buttons
          goldLight: "#F5EBD3",        // soft gold tint for highlight bands
          goldBand: "#D4B968",         // slightly lighter — for the wide header strip
          // Print-faithful CMYK yellow — kept for use in outgoing emails
          // where CMYK fidelity matters (still labeled 'accent'; see emails)
          accent: "#FFAD00",
          accentDark: "#D99100",
          accentLight: "#FFF4D6",
          // Black — corporate 100% K
          ink: "#000000",
          inkSoft: "#1f2937",          // softer for body text
          bg: "#FAF7FE",               // body background, very light purple tint
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
