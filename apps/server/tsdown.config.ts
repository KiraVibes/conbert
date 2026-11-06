import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  // Workspace packages ship TypeScript sources, so they are bundled in.
  // Regular npm dependencies stay external and come from node_modules.
  deps: { alwaysBundle: [/^@conbert\//] },
});
