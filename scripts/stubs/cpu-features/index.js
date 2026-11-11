// ssh2 optionally calls this module to tune its crypto backend. It guards the
// require with try/catch and falls back when the module is unavailable, so a
// no-op result is sufficient and avoids compiling a native addon.
module.exports = () => ({});
