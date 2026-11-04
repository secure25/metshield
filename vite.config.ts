import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Run output is written while dev serves; never watch it (a stray file
    // under runs/ once crashed boot with EBUSY).
    watch: { ignored: ['**/runs/**'] }
  },
  build: {
    outDir: 'dist'
  }
});
