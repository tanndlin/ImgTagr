import { appendFileSync } from 'node:fs';
import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '..', '');
    const bucket = env.AWS_BUCKET ?? 'imgtagr';

    return {
        plugins: [
            react(),
            basicSsl(),
            // TEMPORARY: receives debugLog() posts from the client.
            {
                name: 'debug-log',
                configureServer(server) {
                    server.middlewares.use('/__debug-log', (req, res) => {
                        let body = '';
                        req.on('data', (c) => (body += c));
                        req.on('end', () => {
                            appendFileSync('C:/Users/Tanner/AppData/Local/Temp/claude/C--Users-Tanner-Projects-Github-ImgTagr/006e8547-6771-45a3-940f-39fa2be441dd/scratchpad/client-debug.log', `${new Date().toISOString()} ${req.socket.remoteAddress} ${body}
`);
                            res.end();
                        });
                    });
                },
            },
        ],
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
