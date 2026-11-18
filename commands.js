const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const Storage = require('./storage');
const Tree = require('./tree');
const Editor = require('./editor');

function parentIdOf(item) {
    if (!item) {
        return null;
    }
    return item.type === 'group' ? item.id : item.parentId || null;
}

function uniqueCopyLabel(base, siblings) {
    const names = new Set((siblings || []).map((item) => item.label));
    if (!names.has(base)) {
        return base;
    }
    let label = `${base} copy`;
    let n = 2;
    while (names.has(label)) {
        label = `${base} copy ${n}`;
        n += 1;
    }
    return label;
}

class TerminalManager {
    constructor(context) {
        this.context = context;
        this.storagePath = this.resolveStoragePath();
        this.storage = new Storage(this.storagePath);
        this.tree = new Tree(this.storage);
        this.treeView = undefined;
        this.fileWatcher = undefined;
        this.editor = new Editor(this);
        this._clickTimer = undefined;
        this._lastClick = undefined;
        this._clipboard = undefined;
    }

    createDndController() {
        const mime = 'application/vnd.code.tree.terminalManager';
        const manager = this;
        return {
            dragMimeTypes: [mime],
            dropMimeTypes: [mime],
            handleDrag(source, dataTransfer) {
                const ids = (source || []).map((item) => item && item.id).filter(Boolean);
                dataTransfer.set(mime, new vscode.DataTransferItem(ids));
            },
            handleDrop(target, dataTransfer) {
                const transfer = dataTransfer.get(mime);
                if (!transfer) {
                    return;
                }
                const ids = transfer.value;
                if (!Array.isArray(ids) || !ids.length) {
                    return;
                }
                manager.applyDrop(ids, target);
            }
        };
    }

    applyDrop(ids, target) {
        const storage = this.storage;

        for (const id of ids) {
            const node = storage.findById(id);
            if (!node) {
                continue;
            }
            if (target && target.id === id) {
                continue;
            }
            if (node.type === 'group' && target && storage.isDescendant(id, target.id)) {
                continue;
            }

            if (!target) {
                storage.moveItem(id, null, storage.getRoots().length);
                continue;
            }

            const nodeParent = node.parentId || null;
            const targetParent = target.parentId || null;

            if (target.type === 'group' && nodeParent === target.id) {
                storage.moveItem(id, target.id, (target.children || []).length);
                continue;
            }

            if (target.type === 'group' && nodeParent !== targetParent) {
                storage.moveItem(id, target.id, (target.children || []).length);
                continue;
            }

            const destParent = targetParent;
            const fromIdx = nodeParent === destParent ? storage.siblingIndex(id) : -1;
            const toIdx = storage.siblingIndex(target.id);
            let index;
            if (fromIdx >= 0 && toIdx >= 0 && fromIdx < toIdx) {
                index = toIdx + 1;
            } else {
                index = toIdx < 0 ? undefined : toIdx;
            }
            storage.moveItem(id, destParent, index);
        }

        this.tree.refresh();
    }

    resolveStoragePath() {
        const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        if (!folder || !folder.uri || !folder.uri.fsPath) {
            return null;
        }
        return path.join(folder.uri.fsPath, '.vscode', 'terminals.json');
    }

    bindWorkspace() {
        const next = this.resolveStoragePath();
        const changed = next !== this.storagePath;
        this.storagePath = next;
        this.storage.filePath = next;
        if (changed) {
            this.startWatcher();
        }
        return Boolean(next);
    }

    ensureWorkspace() {
        if (this.bindWorkspace()) {
            return true;
        }
        vscode.window.showErrorMessage('Open a folder first. Terminals are stored in .vscode/terminals.json.');
        return false;
    }

    activate() {
        try {
            this.storage.load();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to load terminals.json: ${e.message}`);
        }

        try {
            this.treeView = vscode.window.createTreeView('terminal-manager', {
                treeDataProvider: this.tree,
                showCollapseAll: false,
                dragAndDropController: this.createDndController()
            });
            this.context.subscriptions.push(this.treeView);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to create Terminals view: ${e.message}`);
        }

        this.context.subscriptions.push({
            dispose: () => {
                if (this._clickTimer) {
                    clearTimeout(this._clickTimer);
                    this._clickTimer = undefined;
                }
                if (this.editor.panel) {
                    this.editor.panel.dispose();
                }
            }
        });

        this.registerCommands();
        try {
            this.watchConfig();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to watch terminals.json: ${e.message}`);
        }
    }

    registerCommands() {
        const commands = [
            ['terminalManager.addTerminal', (item) => this.addTerminal(item)],
            ['terminalManager.addGroup', (item) => this.addGroup(item)],
            ['terminalManager.editItem', (item) => this.editItem(item)],
            ['terminalManager.deleteItem', (item) => this.deleteItem(item)],
            ['terminalManager.copyItem', (item) => this.copyItem(item)],
            ['terminalManager.pasteItem', (item) => this.pasteItem(item)],
            ['terminalManager.moveItem', (item) => this.moveItem(item)],
            ['terminalManager.openTerminal', (item) => this.openTerminal(item)],
            ['terminalManager.onTerminalClick', (item) => this.onTerminalClick(item)],
            ['terminalManager.editJson', () => this.editJson()],
            ['extension.editTerminals', () => this.editJson()],
            ['terminalManager.refresh', () => this.refresh()],
            ['terminalManager.expandAll', () => this.expandAll()],
            ['terminalManager.collapseAll', () => this.collapseAll()]
        ];

        for (const [id, handler] of commands) {
            try {
                this.context.subscriptions.push(vscode.commands.registerCommand(id, (...args) => {
                    try {
                        return handler(...args);
                    } catch (e) {
                        const message = e && e.message ? e.message : String(e);
                        vscode.window.showErrorMessage('Terminal Manager: ' + message);
                        console.error(e);
                    }
                }));
            } catch (e) {
                console.error('Failed to register ' + id, e);
            }
        }
    }

    watchConfig() {
        this.startWatcher();

        this.context.subscriptions.push(
            vscode.workspace.onDidSaveTextDocument((doc) => {
                if (!this.storagePath) {
                    return;
                }
                if (path.resolve(doc.fileName) === path.resolve(this.storagePath)) {
                    this.reloadFromDisk();
                }
            }),
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.bindWorkspace();
                this.reloadFromDisk(true);
            }),
            {
                dispose: () => {
                    if (this.fileWatcher) {
                        this.fileWatcher.dispose();
                        this.fileWatcher = undefined;
                    }
                }
            }
        );
    }

    startWatcher() {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }

        const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        if (!folder) {
            return;
        }

        try {
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(folder, '.vscode/terminals.json')
            );
            this.fileWatcher.onDidChange(() => this.reloadFromDisk());
            this.fileWatcher.onDidCreate(() => this.reloadFromDisk());
            this.fileWatcher.onDidDelete(() => this.reloadFromDisk(true));
        } catch (e) {
            this.fileWatcher = undefined;
            console.error('Failed to watch terminals.json', e);
        }
    }

    reloadFromDisk(force = false) {
        if (!force && this.storage.isSaving()) {
            return;
        }
        try {
            this.storage.load();
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to load terminals.json: ${e.message}`);
            return;
        }
        this.tree.refresh();
    }

    refresh() {
        this.storagePath = this.resolveStoragePath();
        this.storage.filePath = this.storagePath;
        this.reloadFromDisk(true);
    }

    async expandAll() {
        if (!this.treeView) {
            return;
        }
        const walk = async (nodes) => {
            for (const node of nodes || []) {
                if (node.type !== 'group') {
                    continue;
                }
                try {
                    await this.treeView.reveal(node, { expand: true, select: false, focus: false });
                } catch (e) {
                    // node may not be visible yet
                }
                await walk(node.children);
            }
        };
        await walk(this.storage.getRoots());
    }

    collapseAll() {
        return vscode.commands.executeCommand('workbench.actions.treeView.terminal-manager.collapseAll');
    }

    addTerminal(item) {
        if (!this.ensureWorkspace()) {
            return;
        }
        this.editor.open({
            mode: 'add',
            type: 'terminal',
            parentId: parentIdOf(item),
            item: null
        });
    }

    addGroup(item) {
        if (!this.ensureWorkspace()) {
            return;
        }
        this.editor.open({
            mode: 'add',
            type: 'group',
            parentId: parentIdOf(item),
            item: null
        });
    }

    editItem(item) {
        if (!this.ensureWorkspace()) {
            return;
        }
        if (!item && this.treeView && this.treeView.selection.length) {
            item = this.treeView.selection[0];
        }
        if (!item) {
            vscode.window.showInformationMessage('Select a terminal or group to edit.');
            return;
        }
        const live = item.id ? this.storage.findById(item.id) || item : item;
        this.editor.open({
            mode: 'edit',
            type: live.type === 'group' ? 'group' : 'terminal',
            parentId: live.parentId || null,
            item: live
        });
    }

    deleteItem(item) {
        this.editItem(item);
    }

    moveItem(item) {
        this.editItem(item);
    }

    copyItem(item) {
        if (!this.ensureWorkspace()) {
            return;
        }
        if (!item && this.treeView && this.treeView.selection.length) {
            item = this.treeView.selection[0];
        }
        if (!item || !item.id) {
            vscode.window.showInformationMessage('Select a terminal or group to copy.');
            return;
        }
        const live = this.storage.findById(item.id) || item;
        this._clipboard = this.storage.snapshot(live);
    }

    pasteItem(item) {
        if (!this.ensureWorkspace()) {
            return;
        }
        if (!this._clipboard) {
            vscode.window.showInformationMessage('Nothing to paste.');
            return;
        }
        if (!item && this.treeView && this.treeView.selection.length) {
            item = this.treeView.selection[0];
        }

        let parentId = null;
        let index;
        if (item && item.type === 'group') {
            parentId = item.id;
            const group = this.storage.findById(item.id) || item;
            index = (group.children || []).length;
        } else if (item && item.id) {
            parentId = item.parentId || null;
            const at = this.storage.siblingIndex(item.id);
            index = at < 0 ? undefined : at + 1;
        }

        const clone = this.storage.cloneSnapshot(this._clipboard, parentId);
        const siblings = parentId
            ? ((this.storage.findById(parentId) || {}).children || [])
            : this.storage.getRoots();
        clone.label = uniqueCopyLabel(clone.label, siblings);
        this.storage.addItem(clone, parentId, index);
        this.tree.refresh();
    }

    onTerminalClick(item) {
        if (!item || item.type !== 'terminal') {
            return;
        }
        const now = Date.now();
        const id = item.id;
        if (this._lastClick && this._lastClick.id === id && now - this._lastClick.time < 400) {
            if (this._clickTimer) {
                clearTimeout(this._clickTimer);
                this._clickTimer = undefined;
            }
            this._lastClick = undefined;
            this.openTerminal(item);
            return;
        }
        this._lastClick = { id, time: now };
        if (this._clickTimer) {
            clearTimeout(this._clickTimer);
        }
        this._clickTimer = setTimeout(() => {
            this._clickTimer = undefined;
            this.editItem(item);
        }, 320);
    }

    openTerminal(item) {
        if (!item || item.type !== 'terminal') {
            return;
        }
        if (!item.shellPath) {
            vscode.window.showErrorMessage(`Terminal "${item.label}" has no shell path.`);
            return;
        }

        const options = {
            name: item.label,
            shellPath: item.shellPath
        };
        if (item.shellArgs && (!Array.isArray(item.shellArgs) || item.shellArgs.length)) {
            options.shellArgs = item.shellArgs;
        }
        if (item.cwd) {
            options.cwd = item.cwd;
        }
        if (item.env) {
            options.env = item.env;
        }

        const terminal = vscode.window.createTerminal(options);
        terminal.show();
    }

    async editJson() {
        if (!this.ensureWorkspace()) {
            return;
        }
        try {
            if (!fs.existsSync(this.storagePath)) {
                this.storage.save();
            }
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(this.storagePath));
            await vscode.window.showTextDocument(doc);
        } catch (e) {
            vscode.window.showErrorMessage(`Could not open terminals.json: ${e.message}`);
        }
    }
}

module.exports = TerminalManager;
