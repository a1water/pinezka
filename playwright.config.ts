import { defineConfig, devices } from '@playwright/test'
import { basePath } from './base-path.ts'

// The smoke test runs against the production build served under a sub-path,
// as on GitHub Pages. CI passes the real path; locally a made-up one is used.
const base = process.env.BASE_PATH === undefined ? '/subpath-test/' : basePath()
const url = `http://localhost:4173${base}`

// CI tests the exact dist/ it then deploys. Locally the test build goes to its
// own folder, so dist/ is never left built for the made-up sub-path.
const outDir = process.env.CI ? 'dist' : 'dist-e2e'
const preview = `npm run preview -- --outDir ${outDir} --port 4173 --strictPort`

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: url,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'android-chrome', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: process.env.CI ? preview : `npm run build -- --outDir ${outDir} && ${preview}`,
    url,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BASE_PATH: base },
  },
})
