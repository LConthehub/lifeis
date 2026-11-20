export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        // Life Is, from five colours: deep teal #264653, teal #2a9d8f, sand #e9c46a, orange #f4a261 and
        // coral #e76f51. "life" runs from the palest teal down to the deep teal; "honey" is the warm side.
        // The 600 teal is a shade darker than the palette's own, so white text on it is easy to read.
        life: {
          50: '#eef8f6', 100: '#d5efeb', 200: '#abdfd7', 300: '#7acabf', 400: '#4bb3a6',
          500: '#2a9d8f', 600: '#1f7f74', 700: '#23605f', 800: '#264653', 900: '#1b323c',
        },
        honey: { 100: '#fbf0d3', 400: '#e9c46a', 500: '#f4a261', 700: '#8f3f26' },
        coral: '#e76f51',
        cream: '#faf6ef',
      },
      backgroundImage: {
        // The header: deep teal into teal, where white text reads well.
        'life-bar': 'linear-gradient(100deg, #264653 0%, #23605f 45%, #1f7f74 100%)',
        // All five colours, for thin stripes and the sign-in page.
        'life-all': 'linear-gradient(90deg, #264653 0%, #2a9d8f 30%, #e9c46a 62%, #f4a261 82%, #e76f51 100%)',
        'life-sunrise': 'linear-gradient(135deg, #264653 0%, #2a9d8f 42%, #e9c46a 78%, #f4a261 92%, #e76f51 100%)',
      },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
