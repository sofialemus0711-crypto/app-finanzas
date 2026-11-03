import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base relativa: funciona tanto en GitHub Pages (/app-finanzas/) como en local.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
