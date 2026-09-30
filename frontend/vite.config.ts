import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');
    const bucket = env.AWS_BUCKET ?? 'imgtagr';

    return {
        plugins: [react(), basicSsl()],
        server: {
            host: '0.0.0.0',
            port: Number(env.FRONTEND_PORT ?? 5173),
            strictPort: true,
            proxy: {
                '/api': `http://127.0.0.1:${env.API_PORT ?? 3000}`,
                '/media': {
                    target: `http://127.0.0.1:${env.S3_PORT ?? 9000}`,
                    rewrite: (path) => path.replace(/^\/media/, `/${bucket}`),
                },
            },
        },
    };
});
