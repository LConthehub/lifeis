export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // The person chooses: Light, Dark or "same as this device". index.html puts the `dark` class on <html> before the
  // page draws (see the script there), and Settings > Look changes it.
  darkMode: 'class',
  theme: {
    extend: {
      // THE COLOURS LIVE HERE (and in docs/build-site.mjs for the website). They are sampled from the owner's own artwork:
      // cream paper, orange caps, rust, toffee, harvest gold, greens and a plum-brown. Lightness is nudged where words must
      // pass WCAG AA; hues stay. Check with: node e2e/redesign-shots.mjs (it audits every word on the main pages).
      colors: {
        // "life" runs from cream paper (50) through peach and pumpkin to rust (500, 600: white text on buttons), then plum
        // (700) and deep plum-brown (800 headings, 900). In dark mode 900, 800 and 700 are the night backgrounds and
        // 50 to 400 are the cream and peach words.
        life: {
          50: '#f9f0dd', 100: '#f2e3c6', 200: '#e8d0a8', 300: '#f0b887', 400: '#e58f55',
          500: '#a15221', 600: '#833e16', 700: '#5e2e4d', 800: '#3d2034', 900: '#2c1625',
        },
        // Harvest gold, pumpkin orange and a deep rust (700: white or cream text sits on it).
        honey: { 100: '#fbe9bd', 400: '#eead3e', 500: '#e7602b', 700: '#8c3a14' },
        // The mushroom cap.
        coral: '#e7602b',
        cream: '#f5e8cd',
        // The deep plum-brown of the night.
        night: '#231120',
        // The greens of the artwork. Used sparingly: the section you are in, success, a stripe.
        avocado: { 100: '#e6efd3', 400: '#498f54', 600: '#3a742f', 800: '#25461f' },
        // Greys with a little plum in them, so the words sit well on cream and on the night.
        gray: {
          50: '#faf4e8', 100: '#f3ebdb', 200: '#e5d9c4', 300: '#cdbfae', 400: '#7a6670',
          500: '#6b5560', 600: '#56434d', 700: '#44323c', 800: '#33222c', 900: '#231620',
        },
      },
      backgroundImage: {
        // The header: plum-brown into rust, where white text reads well.
        'life-bar': 'linear-gradient(100deg, #3d2034 0%, #5a2c3c 50%, #93441c 100%)',
        // The artwork's stripes, in its order: plum, green, gold, orange, cream. Flat bands, hard edged.
        'life-all': 'linear-gradient(180deg, #60304f 0 20%, #3a742f 20% 40%, #f2ce47 40% 60%, #e7602c 60% 80%, #f5e8cd 80% 100%)',
        // The same bands on the diagonal.
        'life-sunrise': 'linear-gradient(135deg, #60304f 0 20%, #3a742f 20% 40%, #f2ce47 40% 60%, #e7602c 60% 80%, #f5e8cd 80% 100%)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Headings and the name: Fraunces, soft and a little wonky, from the font files bundled with the app.
        display: ['"Fraunces Variable"', 'Georgia', 'Cambria', 'serif'],
      },
      borderRadius: { '2xl': '1.25rem', '3xl': '1.75rem' },
    },
  },
  plugins: [],
};
