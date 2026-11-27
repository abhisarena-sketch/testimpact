import type { NextConfig } from 'next';

const config: NextConfig = {
  // The analysis engine runs only in server route handlers; keep it (and the TypeScript compiler) out of bundles.
  serverExternalPackages: ['typescript', '@testimpact/core', '@testimpact/dependency-analyzer', '@testimpact/test-discovery', '@testimpact/framework-adapters'],
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
