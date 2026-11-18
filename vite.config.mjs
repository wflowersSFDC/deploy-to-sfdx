import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    root: 'src/client',
    publicDir: 'public',
    build: { outDir: '../../dist', emptyOutDir: true },
    server: {
        port: 5173,
        proxy: Object.fromEntries(['/launch', '/results', '/delete', '/trial', '/authUrl', '/token', '/pools']
            .map(route => [route, process.env.CLIENT_API_ORIGIN || 'http://localhost:8443']))
    },
    test: {
        environment: 'jsdom',
        include: ['**/*.test.ts', '**/*.test.tsx'],
        setupFiles: [fileURLToPath(new URL('./src/client/testSetup.ts', import.meta.url))]
    }
});
