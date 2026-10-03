module.exports = {
  apps: [{
    name: "apex-av1-production",
    script: "./index.mjs",
    interpreter: "node",
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 50,
    time: true,
    kill_timeout: 10000,
    env: {
      NODE_ENV: "production"
    }
  }]
};
