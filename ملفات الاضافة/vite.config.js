import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    // Output directly to the plugin folder for Obsidian to read
    outDir: '.',
    emptyOutDir: false,
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
    sourcemap: 'inline' // Helpful for debugging within Obsidian
  }
});
