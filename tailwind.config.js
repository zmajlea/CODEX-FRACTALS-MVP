/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'vellum': '#FCFBF9',
        'amber': '#EBC06D',
        'cinnabar': '#E67E50',
        'bone': '#DED9D1',
        'obsidian': '#1A1A1B',
        'oxford': '#2C3E50',
        'emerald': '#10b981',
      },
      fontFamily: {
        'head': ['var(--font-head)', 'serif'],
        'data': ['var(--font-data)', 'monospace'],
      },
      borderRadius: {
        'premium': '2px',
      },
      letterSpacing: {
        'widest': '0.15em',
        'ultra': '0.3em',
      }
    }
  },
  plugins: []
};

