export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // Life Is: a calm sage green with a warm honey accent, on cream. Clearly not Sworkr's pink.
        life: {
          50: '#f1f7f4', 100: '#dcede5', 200: '#b9dbcb', 300: '#8ec3ab', 400: '#5fa688',
          500: '#3d8a6c', 600: '#2f6f57', 700: '#275a48', 800: '#1f463a', 900: '#16332b',
        },
        honey: { 100: '#fbecd2', 400: '#efb558', 500: '#e9a23b', 700: '#9a5f12' },
        cream: '#faf6ef',
      },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
