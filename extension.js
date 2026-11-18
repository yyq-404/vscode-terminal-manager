const TerminalManager = require('./commands.js');

/**
 * @param {import('vscode').ExtensionContext} context
 */
function activate(context) {
    try {
        const terminalManager = new TerminalManager(context);
        terminalManager.activate();
    } catch (e) {
        const vscode = require('vscode');
        const message = e && e.message ? e.message : String(e);
        vscode.window.showErrorMessage('Terminal Manager failed to start: ' + message);
        console.error(e);
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
