import type { NextConfig } from 'next';
const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  serverExternalPackages: ['better-sqlite3'],
  outputFileTracingExcludes: {
    '/*': ['./.local/**/*', './private-storage/**/*'],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
