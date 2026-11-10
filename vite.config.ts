/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { basePath } from './base-path.ts'

export default defineConfig({
  base: basePath(),
  plugins: [react()],
  define: {
    // Shown on screen so the phone check can confirm which deploy it is looking at.
    __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  },
  test: {
    // Data and backup tests run in Node, where Blobs survive IndexedDB's
    // structured clone. A DOM test environment would silently lose their bytes.
    environment: 'node',
    // Unit tests are *.test.ts(x), next to the code or under tests/.
    // Playwright's files are tests/e2e/*.spec.ts and are not collected here.
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup-idb.ts'],
  },
})
