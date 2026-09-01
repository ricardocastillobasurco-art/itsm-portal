module.exports = {
    apps: [
        {
            name:         'equipment-app',
            script:       'server.js',
            cwd:          'C:\\project-root - copia',
            interpreter:  'node',
            instances:    1,
            exec_mode:    'fork',
            windowsHide:  true,      // sin ventanas visibles en Windows
            autorestart:  true,
            watch:        false,      // NUNCA watch — solo PM2 reinicia, no nodemon
            max_restarts: 10,
            min_uptime:   '10s',
            env: {
                NODE_ENV: 'production',
            },
        },
        {
            name:         'meshcentral',
            script:       'C:\\meshcentral\\node_modules\\meshcentral\\meshcentral.js',
            cwd:          'C:\\meshcentral',
            interpreter:  'node',
            instances:    1,
            exec_mode:    'fork',
            windowsHide:  true,
            autorestart:  true,
            watch:        false,
            max_restarts: 5,
            min_uptime:   '10s',
        },
    ],
};
