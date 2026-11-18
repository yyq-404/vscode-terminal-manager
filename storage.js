const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

class Storage {
    constructor(filePath) {
        this.filePath = filePath;
        this.roots = [];
        this.index = new Map();
        this._saving = false;
        this._dirty = false;
    }

    isSaving() {
        return this._saving;
    }

    load() {
        this._dirty = false;

        if (!this.filePath || !fs.existsSync(this.filePath)) {
            this.roots = [];
            this._rebuildIndex();
            return;
        }

        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = raw && raw.trim() ? JSON.parse(raw) : [];
        const items = Array.isArray(parsed) ? parsed : [];
        if (!Array.isArray(parsed)) {
            this._dirty = true;
        }

        this.roots = this._normalize(items);
        this._rebuildIndex();

        if (this._dirty) {
            this.save();
        }
    }

    save() {
        if (!this.filePath) {
            return;
        }
        this._saving = true;
        try {
            this._ensureDir();
            fs.writeFileSync(
                this.filePath,
                JSON.stringify(this._serialize(this.roots), null, 4) + '\n',
                'utf8'
            );
        } catch (err) {
            this._saving = false;
            throw err;
        }
        setTimeout(() => {
            this._saving = false;
        }, 300);
    }

    getRoots() {
        return this.roots;
    }

    findById(id) {
        return this.index.get(id);
    }

    addItem(item, parentId = null, index) {
        const node = {
            ...item,
            id: item.id || generateId(),
            parentId: parentId || null
        };
        if (node.type === 'group' && !Array.isArray(node.children)) {
            node.children = [];
        }
        const siblings = this._getSiblings(parentId);
        if (typeof index === 'number' && index >= 0 && index < siblings.length) {
            siblings.splice(index, 0, node);
        } else {
            siblings.push(node);
        }
        this.index.set(node.id, node);
        if (node.children) {
            this._indexTree(node.children);
        }
        this.save();
        return node;
    }

    updateItem(id, patch) {
        const node = this.index.get(id);
        if (!node) {
            return null;
        }
        Object.assign(node, patch);
        this.save();
        return node;
    }

    deleteItem(id) {
        const node = this.index.get(id);
        if (!node) {
            return false;
        }
        const siblings = this._getSiblings(node.parentId);
        const idx = siblings.findIndex((n) => n.id === id);
        if (idx >= 0) {
            siblings.splice(idx, 1);
        }
        this._removeFromIndex(node);
        this.save();
        return true;
    }

    moveItem(id, newParentId, index) {
        const node = this.index.get(id);
        if (!node) {
            return false;
        }

        const targetParentId = newParentId || null;
        if (node.id === targetParentId) {
            return false;
        }
        if (targetParentId && this.isDescendant(node.id, targetParentId)) {
            return false;
        }

        const from = this._getSiblings(node.parentId);
        const fromIdx = from.findIndex((n) => n.id === id);
        if (fromIdx >= 0) {
            from.splice(fromIdx, 1);
        }

        node.parentId = targetParentId;
        const to = this._getSiblings(targetParentId);
        let insertAt = typeof index === 'number' ? index : to.length;
        if (from === to && fromIdx >= 0 && fromIdx < insertAt) {
            insertAt -= 1;
        }
        if (insertAt < 0) {
            insertAt = 0;
        }
        if (insertAt > to.length) {
            insertAt = to.length;
        }
        to.splice(insertAt, 0, node);
        this.save();
        return true;
    }

    snapshot(node) {
        const [out] = this._serialize([node]);
        return out;
    }

    cloneSnapshot(snapshot, parentId = null) {
        const stripped = this._stripIds(JSON.parse(JSON.stringify(snapshot)));
        const [node] = this._normalize([stripped], parentId);
        return node;
    }

    _stripIds(item) {
        if (!item || typeof item !== 'object') {
            return item;
        }
        const { id, parentId, children, ...rest } = item;
        if (Array.isArray(children)) {
            rest.children = children.map((child) => this._stripIds(child));
        }
        return rest;
    }

    siblingIndex(id) {
        const node = this.index.get(id);
        if (!node) {
            return -1;
        }
        return this._getSiblings(node.parentId).findIndex((n) => n.id === id);
    }

    isDescendant(ancestorId, nodeId) {
        let current = this.index.get(nodeId);
        while (current) {
            if (current.id === ancestorId) {
                return true;
            }
            current = current.parentId ? this.index.get(current.parentId) : null;
        }
        return false;
    }

    listGroups() {
        const result = [];
        const walk = (nodes, prefix) => {
            for (const node of nodes) {
                if (node.type === 'group') {
                    const label = prefix ? `${prefix} / ${node.label}` : node.label;
                    result.push({ id: node.id, label });
                    walk(node.children || [], label);
                }
            }
        };
        walk(this.roots, '');
        return result;
    }

    _normalize(items, parentId = null) {
        if (!Array.isArray(items)) {
            return [];
        }

        return items.map((raw) => {
            let id = raw.id;
            if (!id) {
                id = generateId();
                this._dirty = true;
            }

            if (raw.type === 'group' || Array.isArray(raw.children)) {
                if (raw.type !== 'group') {
                    this._dirty = true;
                }
                const node = {
                    ...raw,
                    id,
                    type: 'group',
                    label: raw.label || 'Group',
                    parentId,
                    children: []
                };
                node.children = this._normalize(raw.children || [], id);
                return node;
            }

            if (!raw.type) {
                this._dirty = true;
            }
            return {
                ...raw,
                id,
                type: 'terminal',
                label: raw.label || 'Terminal',
                shellPath: raw.shellPath || '',
                shellArgs: raw.shellArgs,
                parentId
            };
        });
    }

    _serialize(items) {
        return items.map((item) => {
            const { children, ...rest } = item;
            delete rest.parentId;
            if (item.type === 'group') {
                return {
                    ...rest,
                    id: item.id,
                    type: 'group',
                    label: item.label,
                    children: this._serialize(children || [])
                };
            }

            const out = {
                ...rest,
                id: item.id,
                type: 'terminal',
                label: item.label,
                shellPath: item.shellPath
            };
            if (!Array.isArray(out.shellArgs) || !out.shellArgs.length) {
                delete out.shellArgs;
            }
            return out;
        });
    }

    _rebuildIndex() {
        this.index = new Map();
        this._indexTree(this.roots);
    }

    _indexTree(nodes) {
        for (const node of nodes) {
            this.index.set(node.id, node);
            if (node.children && node.children.length) {
                this._indexTree(node.children);
            }
        }
    }

    _removeFromIndex(node) {
        this.index.delete(node.id);
        if (node.children) {
            for (const child of node.children) {
                this._removeFromIndex(child);
            }
        }
    }

    _getSiblings(parentId) {
        if (!parentId) {
            return this.roots;
        }
        const parent = this.index.get(parentId);
        if (!parent || parent.type !== 'group') {
            return this.roots;
        }
        if (!Array.isArray(parent.children)) {
            parent.children = [];
        }
        return parent.children;
    }

    _ensureDir() {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

module.exports = Storage;
module.exports.generateId = generateId;
