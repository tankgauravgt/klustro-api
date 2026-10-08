import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    env: {
      WEB_URL: 'http://localhost:3000',
      APPS_GW__URL: 'http://localhost:4000',
      DB_PATH: ':memory:',
      JWT_SECRET: 'test-jwt-secret',
      JWT_EXPIRES_IN: '1h',
      APPS_AUTH__GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      APPS_AUTH__GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      APPS_AUTH__GITHUB_CLIENT_ID: 'test-github-client-id',
      APPS_AUTH__GITHUB_CLIENT_SECRET: 'test-github-client-secret',
      THROTTLE_TTL_SECONDS: '60',
      THROTTLE_LIMIT: '1000',
      SIGNUP_THROTTLE_LIMIT: '1000',
      MAILGUN_SENDING_API_KEY: 'test-mailgun-key',
      MAILGUN_BASEURL: 'mailgun.test',
    },
    setupFiles: ['./apps/auth/test/_integration/support/mailgun-stub.ts'],
    include: ['**/*.e2e-spec.ts'],
  },
});
