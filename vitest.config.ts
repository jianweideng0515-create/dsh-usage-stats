import tsconfigPaths from 'vite-tsconfig-paths'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Minimal css-module loader for jsdom: the client card imports `*.module.css`,
 * which only the tsdown bundle plugin compiles in production. Under vitest a
 * plain `.module.css` import does not resolve, so stub it to a Proxy that
 * returns each local class name verbatim (enough for text assertions).
 */
function cssModulesStub(): Plugin {
  return {
    name: 'dsh-usage-stats-css-modules-stub',
    resolveId(source: string) {
      if (source.endsWith('.module.css')) return `\0${source}`
      return null
    },
    load(id: string) {
      if (id.startsWith('\0') && id.endsWith('.module.css')) {
        return 'export default new Proxy({}, { get: (_t, key) => String(key) })'
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [cssModulesStub(), tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    pool: 'forks',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
  },
})
