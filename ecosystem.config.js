module.exports = {
  apps: [
    {
      name: 'linkup-backend',
      script: './dist/main.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
      },
      env_staging: {
        NODE_ENV: 'staging',
      },
      // Автоматический перезапуск
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      
      // Логирование
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
      
      // Мониторинг
      min_uptime: '10s',
      max_restarts: 10,
    },
  ],
};
