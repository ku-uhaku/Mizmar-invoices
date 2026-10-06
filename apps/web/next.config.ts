import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // The shared packages ship TypeScript source, so Next compiles them itself
  // rather than needing a separate build step in the dev loop.
  transpilePackages: ['@mizmar/contracts', '@mizmar/core', '@mizmar/doc-template', '@mizmar/i18n'],
  experimental: {
    typedRoutes: false,
  },
};

export default config;
