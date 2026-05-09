const configs = {
  "health-mart": () => require("../configs/health-mart"),
  "pc-raw-data": () => require("../configs/pc-raw-data"),
  "provider-address": () => require("../configs/provider-address"),
};

function listConfigs() {
  return Object.keys(configs).sort();
}

function loadConfig(name) {
  const configName = name || "health-mart";
  const load = configs[configName];

  if (!load) {
    const available = listConfigs().join(", ");
    throw new Error(`Unknown config "${configName}". Available configs: ${available}`);
  }

  return load();
}

module.exports = {
  listConfigs,
  loadConfig,
};
