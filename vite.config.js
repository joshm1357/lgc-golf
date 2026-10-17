import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the app from /lgc-golf/
export default defineConfig({
  base: '/lgc-golf/',
  plugins: [react()],
  test: { environment: 'node' },
});
