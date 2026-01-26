module.exports = {
  apps : [{
    name   : "hms-app",
    script : "./server.js",
    // Watch for file changes (optional, set to true for development)
    watch  : false,
    // Ignore log files to prevent restart loops if watching
    ignore_watch : ["node_modules", "logs"],
    // Restart if memory usage exceeds 1GB
    max_memory_restart: '1G',
    // Environment variables
    env: {
      NODE_ENV: "production",
      PORT: 3000
    }
  }]
}