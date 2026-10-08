import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    env: {
      WEB_URL: 'http://localhost:3000',
      DB_PATH: ':memory:',
      JWT_SECRET: 'test-jwt-secret',
      JWT_EXPIRES_IN: '1h',
      APPS_AUTH__GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      APPS_AUTH__GITHUB_CLIENT_ID: 'test-github-client-id',
      THROTTLE_TTL_SECONDS: '60',
      THROTTLE_LIMIT: '1000',
    },
    include: ['**/*.spec.ts'],
  },
});
