const path = require("node:path");
const root = path.resolve(__dirname, "..");
module.exports = { apps: [{
  name: "sibdel", cwd: root, script: "server.js", interpreter: process.execPath,
  instances: 1, exec_mode: "fork", autorestart: true,
  min_uptime: "10s", max_restarts: 10, exp_backoff_restart_delay: 1000,
  kill_timeout: 15000, max_memory_restart: "768M",
  out_file: path.join(root, "logs/app-out.log"),
  error_file: path.join(root, "logs/app-error.log"),
  env: { NODE_ENV: "production", DOTENV_CONFIG_PATH: path.join(root, ".env") },
}] };
