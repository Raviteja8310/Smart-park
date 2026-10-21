import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true
      },
      '/vision-stream': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true
      }
    }
  }
});
