module.exports = {
  apps: [{
    name: 'agent-hub',
    script: 'dist/index.js',
    cwd: '/home/bajistic/agent-hub',
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    watch: false,
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/home/bajistic/agent-hub/error.log',
    out_file: '/home/bajistic/agent-hub/app.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
