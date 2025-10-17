import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    retry: 'src/retry.ts',
    timeout: 'src/timeout.ts',
    validation: 'src/validation.ts',
  },
  format: ['esm', 'cjs'],
  outDir: 'dist',
  dts: true,
  sourcemap: true,
  clean: true,
});
