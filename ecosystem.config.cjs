module.exports = {
  apps: [{
    name: "apex-autonomous-worker",
    script: "./index.mjs",
    interpreter: "node",
    autorestart: true,
    restart_delay: 5000,
    max_restarts: 50,
    time: true,
    kill_timeout: 10000,
    env: {
      NODE_ENV: "production",
      APEX_WORKER_ONLY: "true"
    }
  }]
};
