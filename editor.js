const fs = require('fs');
const process = require('process');
const vscode = require('vscode');

function getNonce() {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

function parseShellArgs(input) {
    if (!input || !input.trim()) {
        return undefined;
    }
    const trimmed = input.trim();
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        } catch (e) {
            // fall through
        }
    }
    const matches = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g);
    if (!matches) {
        return undefined;
    }
    return matches.map((part) => part.replace(/^"(.*)"$/, '$1'));
}

function getCommonShells() {
    let candidates;
    if (process.platform === 'win32') {
        candidates = [
            { label: 'CMD', path: 'C:\\Windows\\System32\\cmd.exe' },
            { label: 'PowerShell', path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
            { label: 'PowerShell 7', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe' },
            { label: 'WSL', path: 'C:\\Windows\\System32\\wsl.exe' },
            { label: 'Bash', path: 'C:\\Windows\\System32\\bash.exe' },
            { label: 'Git Bash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
            { label: 'Git Bash (x86)', path: 'C:\\Program Files (x86)\\Git\\bin\\bash.exe' }
        ];
    } else if (process.platform === 'darwin') {
        candidates = [
            { label: 'zsh', path: '/bin/zsh' },
            { label: 'bash', path: '/bin/bash' },
            { label: 'sh', path: '/bin/sh' },
            { label: 'fish', path: '/usr/local/bin/fish' },
            { label: 'fish (Homebrew)', path: '/opt/homebrew/bin/fish' }
        ];
    } else {
        candidates = [
            { label: 'bash', path: '/bin/bash' },
            { label: 'zsh', path: '/bin/zsh' },
            { label: 'sh', path: '/bin/sh' },
            { label: 'fish', path: '/usr/bin/fish' }
        ];
    }
    return candidates.filter((shell) => fs.existsSync(shell.path));
}

class Editor {
    constructor(manager) {
        this.manager = manager;
        this.panel = undefined;
        this.state = undefined;
    }

    open(state) {
        this.state = state;
        const title = this._title(state);

        try {
            if (this.panel) {
                this.panel.title = title;
                this.panel.reveal(vscode.ViewColumn.Active);
                this._postInit();
                return;
            }

            this.panel = vscode.window.createWebviewPanel(
                'terminalManagerEditor',
                title,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            this.panel.onDidDispose(() => {
                this.panel = undefined;
                this.state = undefined;
            });
            this.panel.webview.onDidReceiveMessage((message) => {
                Promise.resolve(this._onMessage(message)).catch((err) => {
                    const text = err && err.message ? err.message : String(err);
                    vscode.window.showErrorMessage(`Terminal Manager: ${text}`);
                    this._error(text);
                });
            });
            this.panel.webview.html = this._html(this.panel.webview);
        } catch (err) {
            const text = err && err.message ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to open editor tab: ${text}`);
        }
    }

    _title(state) {
        if (state.mode === 'add') {
            return state.type === 'group' ? 'New Group' : 'New Terminal';
        }
        const name = state.item && state.item.label ? state.item.label : 'Item';
        return state.type === 'group' ? `Edit Group — ${name}` : `Edit Terminal — ${name}`;
    }

    _groupOptions(state) {
        const storage = this.manager.storage;
        const item = state.item;
        const groups = storage.listGroups().filter((group) => {
            if (!item || state.mode === 'add') {
                return true;
            }
            if (item.type === 'group' && (group.id === item.id || storage.isDescendant(item.id, group.id))) {
                return false;
            }
            return true;
        });
        return [{ id: '', label: 'Root' }].concat(groups);
    }

    _postInit() {
        if (!this.panel || !this.state) {
            return;
        }
        const state = this.state;
        const item = state.item || {};
        const parentId = state.mode === 'edit'
            ? (item.parentId || '')
            : (state.parentId || '');

        try {
            this.panel.webview.postMessage({
                type: 'init',
                heading: this._title(state),
                kind: state.type,
                mode: state.mode,
                showDelete: state.mode === 'edit' && Boolean(item.id),
                values: {
                    label: item.label || '',
                    shellPath: item.shellPath || '',
                    shellArgs: Array.isArray(item.shellArgs) ? item.shellArgs : [],
                    cwd: item.cwd || '',
                    parentId: parentId || ''
                },
                groups: this._groupOptions(state),
                shells: getCommonShells()
            });
        } catch (err) {
            const text = err && err.message ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to load editor: ${text}`);
        }
    }

    async _onMessage(message) {
        if (!message || !message.type) {
            return;
        }

        if (message.type === 'ready') {
            this._postInit();
            return;
        }

        if (message.type === 'cancel') {
            if (this.panel) {
                this.panel.dispose();
            }
            return;
        }

        if (message.type === 'browseShell') {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                openLabel: 'Select Shell'
            });
            if (uris && uris.length && this.panel) {
                this.panel.webview.postMessage({
                    type: 'setField',
                    field: 'shellPath',
                    value: uris[0].fsPath
                });
            }
            return;
        }

        if (message.type === 'browseCwd') {
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                canSelectFiles: false,
                canSelectFolders: true,
                openLabel: 'Select Folder'
            });
            if (uris && uris.length && this.panel) {
                this.panel.webview.postMessage({
                    type: 'setField',
                    field: 'cwd',
                    value: uris[0].fsPath
                });
            }
            return;
        }

        if (message.type === 'save') {
            this._save(message.values || {});
            return;
        }

        if (message.type === 'delete') {
            this._delete();
        }
    }

    _save(values) {
        const state = this.state;
        if (!state) {
            return;
        }

        const label = (values.label || '').trim();
        if (!label) {
            this._error('Name is required.');
            return;
        }

        const parentId = values.parentId ? values.parentId : null;
        const storage = this.manager.storage;

        try {
            if (state.type === 'group') {
                if (state.mode === 'add') {
                    storage.addItem({ type: 'group', label, children: [] }, parentId);
                } else if (state.item && state.item.id) {
                    storage.updateItem(state.item.id, { label });
                    if ((state.item.parentId || null) !== parentId) {
                        storage.moveItem(state.item.id, parentId);
                    }
                }
            } else {
                const shellPath = (values.shellPath || '').trim();
                if (!shellPath) {
                    this._error('Shell path is required.');
                    return;
                }
                const patch = {
                    label,
                    shellPath,
                    shellArgs: Array.isArray(values.shellArgs)
                        ? values.shellArgs.map((arg) => String(arg).trim()).filter(Boolean)
                        : parseShellArgs(values.shellArgs),
                    cwd: (values.cwd || '').trim() || undefined
                };
                if (state.mode === 'add') {
                    storage.addItem({ type: 'terminal', ...patch }, parentId);
                } else if (state.item && state.item.id) {
                    storage.updateItem(state.item.id, patch);
                    if ((state.item.parentId || null) !== parentId) {
                        storage.moveItem(state.item.id, parentId);
                    }
                }
            }

            this.manager.tree.refresh();
            if (this.panel) {
                this.panel.dispose();
            }
        } catch (err) {
            const text = err && err.message ? err.message : String(err);
            this._error('Could not save: ' + text);
            vscode.window.showErrorMessage('Could not save terminals.json: ' + text);
        }
    }

    _delete() {
        const state = this.state;
        if (!state || !state.item || !state.item.id) {
            return;
        }
        this.manager.storage.deleteItem(state.item.id);
        this.manager.tree.refresh();
        if (this.panel) {
            this.panel.dispose();
        }
    }

    _error(message) {
        if (this.panel) {
            this.panel.webview.postMessage({ type: 'error', message });
        }
    }

    _html(webview) {
        const nonce = getNonce();
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `script-src 'nonce-${nonce}'`
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    :root {
        --gap: 14px;
    }
    html, body {
        margin: 0;
        padding: 0;
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
    }
    .page {
        max-width: 720px;
        padding: 24px 28px 40px;
        box-sizing: border-box;
    }
    h1 {
        margin: 0 0 6px;
        font-size: 1.4em;
        font-weight: 600;
    }
    .hint {
        margin: 0 0 22px;
        opacity: 0.75;
        line-height: 1.45;
    }
    form {
        display: grid;
        gap: var(--gap);
    }
    label {
        display: grid;
        gap: 6px;
    }
    label > span {
        font-weight: 600;
    }
    .optional {
        font-weight: 400;
        opacity: 0.65;
        margin-left: 6px;
    }
    input, select {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        border: 1px solid var(--vscode-input-border, transparent);
        outline: none;
        font-family: inherit;
        font-size: inherit;
    }
    input:focus, select:focus {
        border-color: var(--vscode-focusBorder);
    }
    .row {
        display: flex;
        gap: 8px;
    }
    .row input {
        flex: 1;
    }
    button {
        padding: 6px 14px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        border: none;
        cursor: pointer;
        font-family: inherit;
        font-size: inherit;
    }
    button:hover {
        background: var(--vscode-button-hoverBackground);
    }
    button.secondary {
        color: var(--vscode-button-secondaryForeground);
        background: var(--vscode-button-secondaryBackground);
    }
    button.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
    }
    button.danger {
        color: var(--vscode-button-foreground);
        background: var(--vscode-inputValidation-errorBackground, #a1260d);
        margin-left: auto;
    }
    button.danger.confirm {
        outline: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c);
    }
    .actions {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 8px;
        padding-top: 14px;
        border-top: 1px solid var(--vscode-widget-border, rgba(127,127,127,0.3));
    }
    .error {
        color: var(--vscode-errorForeground);
        margin: 0;
    }
    #argsBlock {
        display: grid;
        gap: 6px;
    }
    .args-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .args-head > span {
        font-weight: 600;
    }
    #addArg {
        min-width: 32px;
        padding: 4px 10px;
        font-size: 1.15em;
        line-height: 1;
    }
    .args-row {
        display: flex;
        gap: 8px;
    }
    .args-row input {
        flex: 1;
    }
    .args-row .remove-arg {
        min-width: 32px;
        padding: 4px 10px;
    }
    #terminalFields[hidden], #deleteBtn[hidden], .error[hidden] {
        display: none !important;
    }
</style>
</head>
<body>
<div class="page">
    <h1 id="heading">Edit</h1>
    <p class="hint" id="hint">All fields are edited on this tab. Save writes .vscode/terminals.json.</p>
    <form id="form">
        <label>
            <span>Name</span>
            <input id="label" name="label" maxlength="120" autocomplete="off" />
        </label>
        <div id="terminalFields">
            <label>
                <span>Shell path</span>
                <div class="row">
                    <input id="shellPath" name="shellPath" list="shells" autocomplete="off" />
                    <button type="button" class="secondary" id="browseShell">Browse</button>
                </div>
            </label>
            <datalist id="shells"></datalist>
            <div id="argsBlock">
                <div class="args-head">
                    <span>Shell arguments <span class="optional">(optional)</span></span>
                    <button type="button" class="secondary" id="addArg">+</button>
                </div>
                <div id="argsList"></div>
            </div>
            <label>
                <span>Working directory <span class="optional">(optional)</span></span>
                <div class="row">
                    <input id="cwd" name="cwd" placeholder="Leave empty to use the workspace folder" autocomplete="off" />
                    <button type="button" class="secondary" id="browseCwd">Browse</button>
                </div>
            </label>
        </div>
        <label>
            <span>Group</span>
            <select id="parentId" name="parentId"></select>
        </label>
        <p class="error" id="error" hidden></p>
        <div class="actions">
            <button type="button" class="primary" id="saveBtn">Save</button>
            <button type="button" class="secondary" id="cancelBtn">Cancel</button>
            <button type="button" class="danger" id="deleteBtn" hidden>Delete</button>
        </div>
    </form>
</div>
<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const heading = document.getElementById('heading');
    const form = document.getElementById('form');
    const terminalFields = document.getElementById('terminalFields');
    const shells = document.getElementById('shells');
    const parentSelect = document.getElementById('parentId');
    const errorEl = document.getElementById('error');
    const deleteBtn = document.getElementById('deleteBtn');
    const argsList = document.getElementById('argsList');

    function addArgRow(value, focus) {
        const row = document.createElement('div');
        row.className = 'args-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.placeholder = 'Argument';
        input.value = value || '';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary remove-arg';
        remove.textContent = '×';
        remove.addEventListener('click', () => {
            argsList.removeChild(row);
        });
        row.appendChild(input);
        row.appendChild(remove);
        argsList.appendChild(row);
        if (focus) {
            input.focus();
        }
    }

    function setArgRows(args) {
        while (argsList.firstChild) {
            argsList.removeChild(argsList.firstChild);
        }
        (args || []).forEach((arg) => addArgRow(String(arg), false));
    }

    function collectArgs() {
        const values = [];
        argsList.querySelectorAll('input').forEach((input) => {
            const text = (input.value || '').trim();
            if (text) values.push(text);
        });
        return values;
    }

    function showError(text) {
        if (!text) {
            errorEl.hidden = true;
            errorEl.textContent = '';
            return;
        }
        errorEl.hidden = false;
        errorEl.textContent = text;
    }

    function fillSelect(select, items, selected) {
        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }
        items.forEach((item) => {
            const option = document.createElement('option');
            option.value = item.id;
            option.textContent = item.label;
            if (String(item.id) === String(selected || '')) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    }

    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'init') {
            heading.textContent = msg.heading || 'Edit';
            terminalFields.hidden = msg.kind !== 'terminal';
            deleteBtn.hidden = !msg.showDelete;
            deleteBtn.classList.remove('confirm');
            deleteBtn.textContent = 'Delete';
            showError('');
            const values = msg.values || {};
            document.getElementById('label').value = values.label || '';
            document.getElementById('shellPath').value = values.shellPath || '';
            setArgRows(Array.isArray(values.shellArgs) ? values.shellArgs : []);
            document.getElementById('cwd').value = values.cwd || '';
            fillSelect(parentSelect, msg.groups || [{ id: '', label: 'Root' }], values.parentId);
            while (shells.firstChild) {
                shells.removeChild(shells.firstChild);
            }
            (msg.shells || []).forEach((shell) => {
                const option = document.createElement('option');
                option.value = shell.path;
                option.label = shell.label;
                shells.appendChild(option);
            });
            document.getElementById('label').focus();
        }
        if (msg.type === 'setField' && msg.field) {
            const el = document.getElementById(msg.field);
            if (el) el.value = msg.value || '';
        }
        if (msg.type === 'error') {
            showError(msg.message || 'Could not save.');
        }
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        event.stopPropagation();
        submit();
    });
    document.getElementById('saveBtn').addEventListener('click', submit);

    function submit() {
        showError('');
        vscode.postMessage({
            type: 'save',
            values: {
                label: document.getElementById('label').value,
                shellPath: document.getElementById('shellPath').value,
                shellArgs: collectArgs(),
                cwd: document.getElementById('cwd').value,
                parentId: parentSelect.value
            }
        });
    }

    document.getElementById('cancelBtn').addEventListener('click', () => {
        vscode.postMessage({ type: 'cancel' });
    });
    document.getElementById('addArg').addEventListener('click', () => {
        addArgRow('', true);
    });
    document.getElementById('browseShell').addEventListener('click', () => {
        vscode.postMessage({ type: 'browseShell' });
    });
    document.getElementById('browseCwd').addEventListener('click', () => {
        vscode.postMessage({ type: 'browseCwd' });
    });
    deleteBtn.addEventListener('click', () => {
        if (!deleteBtn.classList.contains('confirm')) {
            deleteBtn.classList.add('confirm');
            deleteBtn.textContent = 'Click again to delete';
            return;
        }
        vscode.postMessage({ type: 'delete' });
    });

    vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
    }
}

module.exports = Editor;
