import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // rampawar123.github.io is a user-site domain, so assets live at the domain root.
  base: '/yashwin-app-store/',
  plugins: [react(), tailwindcss()],
  server: { port: 3000, host: '0.0.0.0' }
});
