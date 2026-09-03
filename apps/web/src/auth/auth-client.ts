import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { apiUrl } from '../config/api-url';

export const authClient = createAuthClient({
  baseURL: apiUrl,
  basePath: '/api/auth',
  plugins: [emailOTPClient()],
});
