import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

function copyBuildPlugin() {
  return {
    name: 'copy-build-plugin',
    closeBundle() {
      const files = ['main.js', 'styles.css'];
      files.forEach(file => {
        const src = path.join('dist', file);
        const dest = path.join('.', file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
          console.log(`[Vite Copy Plugin] Copied ${file} to project root.`);
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const isWatch = process.argv.includes('--watch') || process.argv.includes('-w');
  const isProd = mode === 'production' && !isWatch;

  return {
    plugins: [copyBuildPlugin()],
    build: {
      // Output to a dist folder, then post-build scripts copy to root
      outDir: 'dist',
      emptyOutDir: true,
      lib: {
        entry: 'src/main.js',
        name: 'main',
        fileName: () => 'main.js',
        formats: ['cjs']
      },
      rollupOptions: {
        // Don't bundle obsidian API
        external: ['obsidian'],
        output: {
          // Output CSS as styles.css for Obsidian
          assetFileNames: (assetInfo) => {
            if (assetInfo.name === 'style.css' || assetInfo.name?.endsWith('.css')) {
              return 'styles.css';
            }
            return assetInfo.name;
          }
        }
      },
      sourcemap: isProd ? false : 'inline' // Inline for dev/watch, disabled for production
    }
  };
});
