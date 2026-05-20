(function attachInventoryStorage(global) {
  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function readText(key) {
    try {
      return global.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeText(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    try {
      global.localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function readJson(key, fallback) {
    const text = readText(key);
    if (!text) return clone(fallback);
    try {
      return JSON.parse(text) || clone(fallback);
    } catch {
      return clone(fallback);
    }
  }

  function writeJson(key, value) {
    return writeText(key, JSON.stringify(value));
  }

  global.InventoryStorage = {
    clone,
    readJson,
    readText,
    remove,
    writeJson,
    writeText,
  };
})(globalThis);
