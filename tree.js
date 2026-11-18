const vscode = require('vscode');

class Tree {
    constructor(storage) {
        this.storage = storage;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh(element) {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element) {
        if (!element) {
            return new vscode.TreeItem('Unknown');
        }
        const isGroup = element.type === 'group';
        const item = new vscode.TreeItem(
            element.label,
            isGroup
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
        );

        item.id = element.id;
        item.contextValue = element.type;

        if (isGroup) {
            const count = (element.children || []).length;
            item.iconPath = new vscode.ThemeIcon('folder');
            item.tooltip = element.label;
            item.description = count ? String(count) : undefined;
        } else {
            item.iconPath = new vscode.ThemeIcon('terminal');
            item.tooltip = `${element.shellPath || element.label}\nClick to edit · Double-click to run`;
            item.command = {
                command: 'terminalManager.onTerminalClick',
                title: 'Edit or Run Terminal',
                arguments: [element]
            };
        }

        return item;
    }

    getChildren(element) {
        try {
            if (!element) {
                return this.storage.getRoots() || [];
            }
            if (element.type === 'group') {
                return element.children || [];
            }
            return [];
        } catch (e) {
            console.error(e);
            return [];
        }
    }

    getParent(element) {
        if (!element || !element.parentId) {
            return undefined;
        }
        return this.storage.findById(element.parentId);
    }
}

module.exports = Tree;
