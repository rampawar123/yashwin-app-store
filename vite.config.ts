import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'github-pages-compat-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/yashwin-app-store/')) {
            req.url = req.url.replace(/^\/yashwin-app-store\//, '/');
          }
          next();
        });
      }
    },
    react(),
    tailwindcss()
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: true
  }
});

