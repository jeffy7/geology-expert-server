module.exports = {
  apps: [
    {
      name: 'geology-expert-server',
      script: 'dist/index.js',
      cwd: '/var/www/geology-expert/server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 8080
      }
    }
  ]
}

