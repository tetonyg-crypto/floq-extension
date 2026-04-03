/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./entrypoints/**/*.{ts,tsx,html}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#2563eb',
        'accent-hover': '#1d4ed8',
        success: '#16a34a',
        'text-primary': '#1a202c',
        'text-secondary': '#718096',
        'border-light': '#e2e8f0',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
