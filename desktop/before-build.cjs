// The launcher imports only Electron/Node builtins. Next's traced dependencies
// are staged separately under resources/server; do not collect the workspace
// dependency graph into app.asar a second time.
module.exports = async () => false;
