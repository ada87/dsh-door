import { build } from 'esbuild'

/**
 * Bundle the plugin into one ESM file. dsh packages stay external because the
 * Host owns those instances; every third-party dependency is bundled so a
 * linked checkout (which keeps its own node_modules) still runs.
 */
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  legalComments: 'none',
  external: [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-app-boot',
    '@deepseek-ai/dsh-*',
  ],
  banner: {
    js: '// dsh-door - bundled by esbuild; dsh services stay external.',
  },
})
