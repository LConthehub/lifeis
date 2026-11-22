// Which browser the walk-throughs drive. On Windows, Edge is always there; elsewhere, the Chromium that
// Playwright knows of. Either can be named: E2E_CHANNEL=chrome, or E2E_BROWSER=/path/to/chromium.
const path = process.env.E2E_BROWSER;
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

export const browserChoice = path ? { executablePath: path } : channel ? { channel } : {};
