const fs = require("node:fs");
const path = require("node:path");

const CONFIG_DIR = path.resolve(__dirname, "../configs");

function listConfigs() {
  return fs
    .readdirSync(CONFIG_DIR)
    .filter((file) => file.endsWith(".js"))
    .map((file) => path.basename(file, ".js"))
    .sort();
}

function loadConfig(name) {
  const configName = name || "health-mart";
  const configPath = path.join(CONFIG_DIR, `${configName}.js`);

  if (!fs.existsSync(configPath)) {
    const available = listConfigs().join(", ");
    throw new Error(`Unknown config "${configName}". Available configs: ${available}`);
  }

  return require(configPath);
}

module.exports = {
  listConfigs,
  loadConfig,
};
