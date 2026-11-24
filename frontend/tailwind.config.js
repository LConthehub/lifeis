export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  // The person chooses: Light, Dark or "same as this device". index.html puts the `dark` class on <html> before the
  // page draws (see the script there), and Settings > Look changes it.
  darkMode: 'class',
  theme: {
    extend: {
      // THE COLOURS LIVE HERE (and in docs/build-site.mjs for the website). The base is chocolate browns on cream; the accents
      // (plum, green, gold, orange) come from the owner's own artwork and are used sparingly. They may be re-tuned to match it.
      // Lightness is chosen so words pass WCAG AA: check with node e2e/redesign-shots.mjs (it audits every word on the main pages).
      colors: {
        // "life" runs from cream paper (50) down to chocolate (900). 600 carries white text on buttons, 800 is the heading
        // brown, 50 and 100 are the soft backgrounds. In dark mode 900, 800 and 700 are the chocolate backgrounds and
        // 50 to 400 are the cream and toffee words.
        life: {
          50: '#fbf4e4', 100: '#f3e6c9', 200: '#e4cfa4', 300: '#d2b184', 400: '#c29a68',
          500: '#8c5a33', 600: '#734825', 700: '#533519', 800: '#422a17', 900: '#2e1c0d',
        },
        // Harvest gold, orange and a deep rust (700: white or cream text sits on it).
        honey: { 100: '#fbe9bd', 400: '#eead3e', 500: '#e7602b', 700: '#8c3a14' },
        // The mushroom-cap orange.
        coral: '#e7602b',
        cream: '#faf3e3',
        card: '#fbf3e0',
        // The page behind the sheet: light, and the dark chocolate night.
        paper: '#f1e5c8',
        night: '#2a190d',
        // The artwork's accents: plum (a tint for dark mode), and green for the section you are in and for success.
        plum: { 500: '#60304f', 300: '#b98aa8' },
        avocado: { 100: '#e6efd3', 400: '#498f54', 600: '#3a742f', 800: '#25461f' },
        // Greys with a little brown in them.
        gray: {
          50: '#faf6ef', 100: '#f3ede1', 200: '#e5dccb', 300: '#cfc3ac', 400: '#7a6c58',
          500: '#6f6252', 600: '#5a4e40', 700: '#473d31', 800: '#33291f', 900: '#231b13',
        },
      },
      backgroundImage: {
        // The header: chocolate into rust, where white text reads well.
        'life-bar': 'linear-gradient(100deg, #4a2f1a 0%, #5f361b 55%, #933f1d 100%)',
        // The artwork's stripe order, as plain flat bands: plum, green, gold, orange, cream. A placeholder for the owner's wave.
        'life-all': 'linear-gradient(180deg, #60304f 0 20%, #3a742f 20% 40%, #f2ce47 40% 60%, #e7602c 60% 80%, #f5e8cd 80% 100%)',
        'life-sunrise': 'linear-gradient(135deg, #60304f 0 20%, #3a742f 20% 40%, #f2ce47 40% 60%, #e7602c 60% 80%, #f5e8cd 80% 100%)',
      },
      fontFamily: {
        // Everything else: Nunito, rounded like the Soft Fraunces, also bundled with the app (SIL Open Font License).
        sans: ['"Nunito Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Headings and the name: Fraunces, soft and a little wonky, from the font files bundled with the app.
        display: ['"Fraunces Variable"', 'Georgia', 'Cambria', 'serif'],
      },
      borderRadius: { '2xl': '1.25rem', '3xl': '1.75rem' },
    },
  },
  plugins: [],
};
