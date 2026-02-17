// ============================================================
// Blue MindMap Pro — script.js
// 5px threshold でクリック/ドラッグを厳密に分離
// ============================================================

const DRAG_THRESHOLD = 5;   // px — これ未満はクリック扱い
const DETACH_DISTANCE = 150; // px — 親からこれ以上離すと切断

const app = {
    // ---------- 状態 ----------
    store: { currentMapId: null, maps: {} },
    nodes: [],
    view: { scale: 1, tx: 0, ty: 0 },
    selectedId: null,
    dom: {},

    // mousedown で記録し、mousemove で閾値判定
    pointer: {
        down: false,
        isDragging: false,      // 5px 超えたら true
        type: null,             // 'node' | 'pan' | null
        node: null,             // ドラッグ対象ノード
        startX: 0, startY: 0,  // clientX/Y at mousedown
        origNodeX: 0, origNodeY: 0,
        origParentId: null,
        dropTargetId: null,
    },

    // ==========================================================
    //  初期化
    // ==========================================================
    init() {
        this.dom = {
            viewport: document.getElementById('viewport'),
            world: document.getElementById('world'),
            nodes: document.getElementById('nodes-layer'),
            lines: document.getElementById('connections-layer'),
            mapList: document.getElementById('map-list'),
        };

        this.loadStore();

        if (Object.keys(this.store.maps).length === 0) {
            this.createNewMap();
        } else {
            const id = this.store.currentMapId || Object.keys(this.store.maps)[0];
            this.switchMap(id);
        }

        this._bindGlobalEvents();
        this.render();
        this.renderMapList();
    },

    // ==========================================================
    //  アーカイブ管理 (store ↔ localStorage)
    // ==========================================================
    createNewMap() {
        // 現在のマップがあれば保存
        if (this.store.currentMapId) this.saveCurrentMap();

        const id = 'map-' + Date.now();
        const root = { id: 'root', text: 'New Idea', parentId: null, isCollapsed: false, x: 0, y: 0 };
        this.store.maps[id] = { title: 'New Idea', data: [root], lastModified: Date.now() };
        this.switchMap(id);
    },

    switchMap(mapId) {
        if (!this.store.maps[mapId]) return;
        if (this.store.currentMapId && this.store.maps[this.store.currentMapId]) {
            this.saveCurrentMap();
        }
        this.store.currentMapId = mapId;
        this.nodes = JSON.parse(JSON.stringify(this.store.maps[mapId].data));
        this.view = { scale: 1, tx: 0, ty: 0 };
        this.selectedId = null;
        this.centerMap();
        this.render();
        this.renderMapList();
        this.saveStore();
    },

    saveCurrentMap() {
        if (!this.store.currentMapId) return;
        const roots = this.nodes.filter(n => n.parentId === null);
        const title = roots.length > 0 ? roots[0].text : 'Untitled';
        this.store.maps[this.store.currentMapId] = {
            title,
            data: JSON.parse(JSON.stringify(this.nodes)),
            lastModified: Date.now(),
        };
        this.saveStore();
    },

    deleteMap(e, mapId) {
        e.stopPropagation();
        if (!confirm('このマップを削除しますか？')) return;
        delete this.store.maps[mapId];
        if (this.store.currentMapId === mapId) {
            this.store.currentMapId = null;
            const keys = Object.keys(this.store.maps);
            if (keys.length > 0) this.switchMap(keys[0]);
            else this.createNewMap();
        } else {
            this.saveStore();
            this.renderMapList();
        }
    },

    renderMapList() {
        const list = this.dom.mapList;
        list.innerHTML = '';
        this._ensureOrder();
        const keys = this.store.order;
        keys.forEach((k, idx) => {
            const m = this.store.maps[k];
            if (!m) return;
            const row = document.createElement('div');
            row.className = 'map-item' + (k === this.store.currentMapId ? ' active' : '');

            const title = document.createElement('span');
            title.className = 'map-title';
            title.textContent = m.title;
            row.appendChild(title);
            row.onclick = () => this.switchMap(k);

            // 並び替えボタン
            const controls = document.createElement('span');
            controls.className = 'map-controls';

            if (idx > 0) {
                const up = document.createElement('span');
                up.className = 'map-sort-btn';
                up.textContent = '↑';
                up.onclick = (e) => { e.stopPropagation(); this.moveMap(k, -1); };
                controls.appendChild(up);
            }
            if (idx < keys.length - 1) {
                const dn = document.createElement('span');
                dn.className = 'map-sort-btn';
                dn.textContent = '↓';
                dn.onclick = (e) => { e.stopPropagation(); this.moveMap(k, 1); };
                controls.appendChild(dn);
            }

            const del = document.createElement('span');
            del.className = 'map-delete';
            del.textContent = '×';
            del.onclick = (e) => this.deleteMap(e, k);
            controls.appendChild(del);

            row.appendChild(controls);
            list.appendChild(row);
        });
    },

    _ensureOrder() {
        if (!this.store.order) this.store.order = [];
        // mapsにあってorderに無いキーを追加
        Object.keys(this.store.maps).forEach(k => {
            if (!this.store.order.includes(k)) this.store.order.push(k);
        });
        // orderにあってmapsに無いキーを除去
        this.store.order = this.store.order.filter(k => this.store.maps[k]);
    },

    moveMap(mapId, direction) {
        this._ensureOrder();
        const arr = this.store.order;
        const i = arr.indexOf(mapId);
        const j = i + direction;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        this.saveStore();
        this.renderMapList();
    },

    saveStore() { localStorage.setItem('all_maps', JSON.stringify(this.store)); },
    loadStore() {
        const raw = localStorage.getItem('all_maps');
        if (raw) {
            try { this.store = JSON.parse(raw); } catch (_) { /* ignore */ }
        }
    },

    _esc(s) { const d = document.createElement('span'); d.textContent = s; return d.innerHTML; },

    // ==========================================================
    //  データ操作
    // ==========================================================
    createNode(text, parentId, side = 'right') {
        return {
            id: 'n-' + Date.now() + Math.random().toString(36).substr(2, 5),
            text, parentId, side,
            collapsedLeft: false, collapsedRight: false,
            x: 0, y: 0, fontSize: 14,
        };
    },

    deleteNode(id) {
        const kids = this.nodes.filter(n => n.parentId === id);
        kids.forEach(c => this.deleteNode(c.id));
        this.nodes = this.nodes.filter(n => n.id !== id);
    },

    isDescendant(nodeId, potentialAncestorId) {
        let cur = this.nodes.find(n => n.id === potentialAncestorId);
        while (cur && cur.parentId) {
            if (cur.parentId === nodeId) return true;
            cur = this.nodes.find(n => n.id === cur.parentId);
        }
        return false;
    },

    // 祖先に isCollapsed === true がいれば非表示
    // 祖先の collapsedLeft / collapsedRight をチェックして表示判定
    isNodeVisible(node) {
        if (!node.parentId) return true; // ルートは常に表示
        const parent = this.nodes.find(n => n.id === node.parentId);
        if (!parent) return true;

        // 親が自分側の方向を折りたたんでいたら非表示
        const isLeft = node.side === 'left';
        if (isLeft && parent.collapsedLeft) return false;
        if (!isLeft && parent.collapsedRight) return false;

        return this.isNodeVisible(parent);
    },

    // ==========================================================
    //  自動レイアウト
    // ==========================================================
    updateLayout() {
        const dragNode = this.pointer.isDragging ? this.pointer.node : null;
        this.nodes.filter(n => n.parentId === null).forEach(root => {
            this._layoutSubtree(root, root.x, root.y, dragNode);
        });
    },

    _layoutSubtree(node, x, y, dragNode) {
        if (node === dragNode) { /* ドラッグ中 → 座標はマウス追従 */ }
        else { node.x = x; node.y = y; }


        const children = this.nodes.filter(n => n.parentId === node.id);
        if (children.length === 0) return;

        const totalH = this._subtreeH(node);
        let cy = node.y - totalH / 2;

        children.forEach(child => {
            const ch = this._subtreeH(child);
            // side に応じて左右に配置
            const childX = child.side === 'left' ? node.x - 220 : node.x + 220;
            this._layoutSubtree(child, childX, cy + ch / 2, dragNode);
            cy += ch + 20;
        });
    },

    _subtreeH(node) {
        // 表示されている子ノードだけを高さ計算に含める
        const kids = this.nodes.filter(n => n.parentId === node.id);
        const visibleKids = kids.filter(k => {
            const isLeft = k.side === 'left';
            if (isLeft && node.collapsedLeft) return false;
            if (!isLeft && node.collapsedRight) return false;
            return true;
        });

        if (visibleKids.length === 0) return 50;
        return visibleKids.reduce((s, c) => s + this._subtreeH(c), 0) + (visibleKids.length - 1) * 20;
    },

    // ==========================================================
    //  描画 — Two-Pass (1: DOM nodes, 2: lines from actual sizes)
    // ==========================================================
    render() {
        // ドラッグ中はレイアウト更新しない（ガタつき防止）
        if (!this.pointer.isDragging) this.updateLayout();

        // --- Pass 1: ノード描画 ---
        this.dom.nodes.innerHTML = '';
        const visibleNodes = [];

        this.nodes.forEach(node => {
            if (!this.isNodeVisible(node)) return;
            visibleNodes.push(node);

            const el = document.createElement('div');
            const isRoot = node.parentId === null;
            el.className = 'node'
                + (isRoot ? ' root' : '')
                + (node.id === this.selectedId ? ' selected' : '');
            el.id = node.id;
            el.contentEditable = 'false';
            el.setAttribute('tabindex', '0');  // keyboard focus without contentEditable
            el.innerText = node.text;
            el.style.transform = `translate(${node.x}px, ${node.y}px)`;

            // フォントサイズ適用
            const fs = node.fontSize || 14;
            el.style.setProperty('font-size', fs + 'px', 'important'); // !importantで強制
            el.style.minHeight = (fs * 1.5) + 'px'; // 高さも確保
            el.style.height = 'auto'; // 文字サイズ変更に高さを追従させる

            // ドラッグ中の視覚フィードバック
            if (this.pointer.isDragging && this.pointer.node === node) {
                el.classList.add('dragging');
            }
            if (this.pointer.isDragging && this.pointer.dropTargetId === node.id && this.pointer.node !== node) {
                el.classList.add('drop-target');
            }

            // イベント
            el.addEventListener('mousedown', (e) => this._onNodeDown(e, node));
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this._enterEditMode(node.id);
            });
            el.addEventListener('input', () => { node.text = el.innerText; });
            el.addEventListener('blur', () => {
                const text = el.innerText.trim();
                // 空なら削除 (ルート以外)
                if (text === '') {
                    if (node.parentId !== null) {
                        this.deleteNode(node.id);
                        this.selectedId = node.parentId; // 親を選択
                        this.render();
                        this.saveCurrentMap();
                        this.renderMapList();
                        return; // 終了
                    } else {
                        // ルートならデフォルトに戻す
                        node.text = 'Central Idea';
                        el.innerText = 'Central Idea';
                    }
                }

                node.text = el.innerText; // trimしたくない場合もあるのでinnerTextそのまま
                el.contentEditable = 'false';
                el.style.cursor = '';
                this.saveCurrentMap();
                this.renderMapList();
            });
            el.addEventListener('keydown', (e) => this._onNodeKey(e, node));

            this.dom.nodes.appendChild(el);
        });

        // --- Pass 2: 線 & トグル描画 (DOM確定後、実測値を使用) ---
        this.dom.lines.innerHTML = '';

        visibleNodes.forEach(node => {
            // 接続線
            if (node.parentId) {
                const parent = this.nodes.find(n => n.id === node.parentId);
                if (parent && !parent.isCollapsed) {
                    const pEl = document.getElementById(parent.id);
                    const cEl = document.getElementById(node.id);
                    if (pEl && cEl) {
                        // 切断予兆判定: ドラッグ中のノードが親から遠いか
                        let isDetaching = false;
                        if (this.pointer.isDragging && this.pointer.node === node && node.parentId) {
                            const dist = Math.hypot(node.x - parent.x, node.y - parent.y);
                            if (dist > DETACH_DISTANCE) isDetaching = true;
                        }
                        this._drawLine(parent, node, pEl, cEl, isDetaching);
                    }
                }
            }
            // 折りたたみトグル
            // 折りたたみトグル (左右独立)
            if (node.parentId === null || node.id) { // ルートも含む
                const kids = this.nodes.filter(n => n.parentId === node.id);
                if (kids.length > 0) {
                    const leftKids = kids.filter(k => k.side === 'left');
                    const rightKids = kids.filter(k => k.side !== 'left');

                    const nEl = document.getElementById(node.id);
                    if (nEl) {
                        if (leftKids.length > 0) this._drawToggle(node, nEl, 'left');
                        if (rightKids.length > 0) this._drawToggle(node, nEl, 'right');
                    }
                }
            }
        });

        this._applyTransform();
    },

    _drawLine(p, c, pEl, cEl, isDetaching = false) {
        let sx, sy, ex, ey;

        if (c.x >= p.x) {
            // 子が右側: 親右端 → 子左端
            sx = p.x + pEl.offsetWidth;
            sy = p.y + pEl.offsetHeight / 2;
            ex = c.x;
            ey = c.y + cEl.offsetHeight / 2;
        } else {
            // 子が左側: 親左端 → 子右端
            sx = p.x;
            sy = p.y + pEl.offsetHeight / 2;
            ex = c.x + cEl.offsetWidth;
            ey = c.y + cEl.offsetHeight / 2;
        }

        const midX = (sx + ex) / 2;
        const d = `M ${sx},${sy} C ${midX},${sy} ${midX},${ey} ${ex},${ey}`;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-width', '2');

        if (isDetaching) {
            path.setAttribute('stroke', '#FF3B30');
            path.setAttribute('stroke-dasharray', '6 4');
        } else {
            path.setAttribute('stroke', '#007AFF');
        }

        this.dom.lines.appendChild(path);
    },

    _drawToggle(node, nEl, side) {
        let cx, cy;
        // side: 'left' | 'right'
        if (side === 'left') {
            cx = node.x - 14;
        } else {
            cx = node.x + nEl.offsetWidth + 14;
        }
        cy = node.y + nEl.offsetHeight / 2;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', cx);
        circle.setAttribute('cy', cy);
        circle.setAttribute('r', 6);
        circle.setAttribute('class', 'toggle-btn');
        // 状態によって色を変える? 現状はCSSでfill判定していないが、JSで制御
        const isCollapsed = side === 'left' ? node.collapsedLeft : node.collapsedRight;
        if (isCollapsed) {
            circle.setAttribute('fill', '#999'); // 閉じてる感
        }

        circle.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            if (side === 'left') node.collapsedLeft = !node.collapsedLeft;
            else node.collapsedRight = !node.collapsedRight;
            this.render();
        });
        this.dom.lines.appendChild(circle);
    },

    // ==========================================================
    //  イベント — ポインタ統合（5px 閾値）
    // ==========================================================
    _bindGlobalEvents() {
        // --- viewport mousedown (パン開始候補 + 選択解除) ---
        this.dom.viewport.addEventListener('mousedown', (e) => {
            // 【修正箇所】 ノード、トグルボタン、そして「コントロールパネル(ボタン)」へのクリックは無視する
            if (e.target.closest('.node') ||
                e.target.closest('.toggle-btn') ||
                e.target.closest('#controls') ||
                e.target.closest('button') ||
                e.target.closest('.io-buttons')) {
                return;
            }
            // 背景クリックで選択解除
            if (this.selectedId) {
                this.selectedId = null;
                this.render();
            }
            this.pointer.down = true;
            this.pointer.isDragging = false;
            this.pointer.type = 'pan';
            this.pointer.startX = e.clientX;
            this.pointer.startY = e.clientY;
        });

        // --- 背景ダブルクリックで新規ルートノード作成 ---
        this.dom.viewport.addEventListener('dblclick', (e) => {
            if (e.target.closest('.node') ||
                e.target.closest('.toggle-btn') ||
                e.target.closest('#controls') ||
                e.target.closest('button') ||
                e.target.closest('.io-buttons')) {
                return;
            }
            // クリック位置をワールド座標に変換
            const rect = this.dom.viewport.getBoundingClientRect();
            const wx = (e.clientX - rect.left - this.view.tx) / this.view.scale;
            const wy = (e.clientY - rect.top - this.view.ty) / this.view.scale;
            const newRoot = this.createNode('New Idea', null);
            newRoot.x = wx;
            newRoot.y = wy;
            this.nodes.push(newRoot);
            this.selectedId = newRoot.id;
            this.render();
            this.saveCurrentMap();
            this.renderMapList();
            // 即編集モードに入る
            requestAnimationFrame(() => this._enterEditMode(newRoot.id));
        });

        // --- mousemove (グローバル) ---
        window.addEventListener('mousemove', (e) => {
            if (!this.pointer.down) return;

            const dx = e.clientX - this.pointer.startX;
            const dy = e.clientY - this.pointer.startY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // まだ閾値未満 → 何もしない
            if (!this.pointer.isDragging && dist < DRAG_THRESHOLD) return;

            // --- 閾値超え: ドラッグモード開始 ---
            if (!this.pointer.isDragging) {
                this.pointer.isDragging = true;
                // ノードドラッグの場合は contentEditable のフォーカスを外す
                if (this.pointer.type === 'node') {
                    document.activeElement && document.activeElement.blur();
                }
            }

            if (this.pointer.type === 'pan') {
                // パン: startX/Y はオフセット込みで計算
                this.view.tx += (e.clientX - this.pointer.startX);
                this.view.ty += (e.clientY - this.pointer.startY);
                this.pointer.startX = e.clientX;
                this.pointer.startY = e.clientY;
                this._applyTransform();
            }
            else if (this.pointer.type === 'node') {
                e.preventDefault();
                const node = this.pointer.node;
                const mx = (e.clientX - this.pointer.startX) / this.view.scale;
                const my = (e.clientY - this.pointer.startY) / this.view.scale;
                node.x = this.pointer.origNodeX + mx;
                node.y = this.pointer.origNodeY + my;

                // ドロップターゲット判定
                this.pointer.dropTargetId = null;
                const els = document.elementsFromPoint(e.clientX, e.clientY);
                const target = els.find(el => el.classList.contains('node') && el.id !== node.id);
                if (target) this.pointer.dropTargetId = target.id;

                this.render();
            }
        });

        // --- mouseup (グローバル) ---
        window.addEventListener('mouseup', (e) => {
            if (!this.pointer.down) return;

            if (this.pointer.type === 'node') {
                if (this.pointer.isDragging) {
                    // ====== ドロップ処理 ======
                    const node = this.pointer.node;

                    if (this.pointer.dropTargetId) {
                        // A. 他のノード上でドロップ → 結合
                        if (!this.isDescendant(node.id, this.pointer.dropTargetId)) {
                            node.parentId = this.pointer.dropTargetId;
                            // ドロップ位置で左右判定
                            const target = this.nodes.find(n => n.id === this.pointer.dropTargetId);
                            if (target) {
                                node.side = node.x < target.x ? 'left' : 'right';
                            }
                        }
                    } else if (node.parentId) {
                        // B. 空白でドロップ → 距離判定
                        const parent = this.nodes.find(n => n.id === node.parentId);
                        if (parent) {
                            const d = Math.hypot(node.x - parent.x, node.y - parent.y);
                            if (d > DETACH_DISTANCE) {
                                node.parentId = null; // 切断
                            }
                            // 近い場合は元に戻す（キャンセル）— レイアウトが再計算される
                        }
                    }
                    this.pointer.dropTargetId = null;
                    this.pointer.node = null;
                    this.updateLayout();
                    this.render();
                    this.saveCurrentMap();
                    this.renderMapList();
                } else {
                    // ====== クリック処理（5px 未満）→ 選択のみ ======
                    const node = this.pointer.node;
                    this.selectedId = node.id;
                    // render()を呼ばず、選択スタイルだけ更新（DOM再生成を避けdblclickを活かす）
                    this.dom.nodes.querySelectorAll('.node').forEach(el => {
                        el.classList.toggle('selected', el.id === node.id);
                    });
                }
            }

            // ポインタリセット
            this.pointer.down = false;
            this.pointer.isDragging = false;
            this.pointer.type = null;
            this.pointer.node = null;
        });

        // --- ホイールズーム ---
        this.dom.viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.zoom(e.deltaY < 0 ? 0.1 : -0.1);
        }, { passive: false });
    },

    // --- ノード mousedown ---
    _onNodeDown(e, node) {
        e.stopPropagation();
        // 編集モード中のノードではドラッグを禁止し、テキスト選択を優先
        const el = document.getElementById(node.id);
        if (el && el.contentEditable === 'true') {
            return; // ドラッグトラッキングを開始しない
        }
        this.pointer.down = true;
        this.pointer.isDragging = false;
        this.pointer.type = 'node';
        this.pointer.node = node;
        this.pointer.startX = e.clientX;
        this.pointer.startY = e.clientY;
        this.pointer.origNodeX = node.x;
        this.pointer.origNodeY = node.y;
        this.pointer.origParentId = node.parentId;
        this.pointer.dropTargetId = null;
    },

    // ==========================================================
    //  キーボード操作
    // ==========================================================
    _onNodeKey(e, node) {
        const el = document.getElementById(node.id);
        const isEditing = el?.contentEditable === 'true';

        // --- 常に有効なショートカット ---
        if (e.key === 'F2') {
            e.preventDefault();
            this._enterEditMode(node.id);
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            el?.blur();
            return;
        }

        // Tab は編集中でも選択中でも子ノード作成
        if (e.key === 'Tab') {
            e.preventDefault();
            if (isEditing) el?.blur(); // 編集中なら先に確定
            const child = this.createNode('', node.id);
            this.nodes.push(child);
            node.isCollapsed = false;
            this.selectedId = child.id;
            this.render();
            this.saveCurrentMap();
            this.renderMapList();
            setTimeout(() => this._enterEditMode(child.id), 20);
            return;
        }

        // === 編集中 ===
        if (isEditing) {
            if (e.key === 'Enter' && !e.shiftKey) {
                // 編集確定 → 兄弟ノード作成
                e.preventDefault();
                node.text = el.innerText; // テキスト保存
                el.contentEditable = 'false';
                el.style.cursor = '';
                this.saveCurrentMap();
                // 兄弟 or 新ルート作成
                if (node.parentId) {
                    const sib = this.createNode('', node.parentId);
                    this.nodes.push(sib);
                    this.selectedId = sib.id;
                    this.render();
                    this.saveCurrentMap();
                    this.renderMapList();
                    setTimeout(() => this._enterEditMode(sib.id), 20);
                } else {
                    const newRoot = this.createNode('', null);
                    // ルートの場合は近くに配置（重ならないように）
                    newRoot.x = node.x;
                    newRoot.y = node.y + 80;
                    this.nodes.push(newRoot);
                    this.selectedId = newRoot.id;
                    this.render();
                    this.saveCurrentMap();
                    this.renderMapList();
                    setTimeout(() => this._enterEditMode(newRoot.id), 20);
                }
            }
            // Shift+Enter = ノード内改行（ブラウザデフォルト）
            // その他はテキスト入力としてそのまま通す
            return;
        }

        // === 以下は選択モード（非編集）時のみ ===

        // Enter → 兄弟 / 新ルート
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (node.parentId) {
                const sib = this.createNode('', node.parentId);
                this.nodes.push(sib);
                this.selectedId = sib.id;
                this.render();
                this.saveCurrentMap();
                this.renderMapList();
                setTimeout(() => this._enterEditMode(sib.id), 20);
            } else {
                const newRoot = this.createNode('', null);
                newRoot.x = node.x;
                newRoot.y = node.y + 80;
                this.nodes.push(newRoot);
                this.selectedId = newRoot.id;
                this.render();
                this.saveCurrentMap();
                this.renderMapList();
                setTimeout(() => this._enterEditMode(newRoot.id), 20);
            }
        }
        // Delete / Backspace → 削除
        else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            this._tryDeleteNode(node);
        }
        // --- 矢印キーナビゲーション (視覚的) ---
        else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            if (isEditing) el?.blur(); // 編集中なら確定して移動

            let dx = 0, dy = 0;
            if (e.key === 'ArrowUp') dy = -1;
            if (e.key === 'ArrowDown') dy = 1;
            if (e.key === 'ArrowLeft') dx = -1;
            if (e.key === 'ArrowRight') dx = 1;

            const target = this._findNavTarget(node, dx, dy);
            if (target) {
                // 折りたたまれている場合は開く（オプション）
                // 今回は視覚的な移動なので、見えているノードだけを対象にするのが自然
                this._navigateTo(target.id);
            }
        }
    },

    _findNavTarget(curr, dx, dy) {
        // 現在地中心
        const cx = curr.x;
        const cy = curr.y;

        // 候補: 可視ノードすべて（自分以外）
        const candidates = this.nodes.filter(n => n.id !== curr.id && this.isNodeVisible(n));

        let best = null;
        let bestDist = Infinity;

        candidates.forEach(cand => {
            // 方向判定
            const tx = cand.x;
            const ty = cand.y;
            const difX = tx - cx;
            const difY = ty - cy;

            // 厳密な方向フィルタ
            if (dx === 1 && difX <= 0) return; // 右に行きたいのに左にある
            if (dx === -1 && difX >= 0) return;
            if (dy === 1 && difY <= 0) return; // 下に行きたいのに上にある
            if (dy === -1 && difY >= 0) return;

            // 距離 (ユークリッド + 方向の重みづけで補正してもよいが、単純距離で試行)
            const d = difX * difX + difY * difY;

            // 近すぎる軸方向のノードを優先するための重み付け
            // 例えば上下移動なら X差が大きいと不利にする
            let score = d;
            if (dy !== 0) score += Math.abs(difX) * 1000; // 上下移動時は横のズレを嫌う
            if (dx !== 0) score += Math.abs(difY) * 1000; // 左右移動時は縦のズレを嫌う

            if (score < bestDist) {
                bestDist = score;
                best = cand;
            }
        });
        return best;
    },

    _navigateTo(nodeId) {
        this.selectedId = nodeId;
        this.render();
        const el = document.getElementById(nodeId);
        if (el) el.focus();
    },



    // ==========================================================
    //  ユーティリティ
    // ==========================================================
    _tryDeleteNode(node) {
        if (!node.parentId && this.nodes.filter(n => n.parentId === null).length <= 1) return; // 最後のルートは削除不可
        const pid = node.parentId;
        this.deleteNode(node.id);
        this.selectedId = pid;
        this.render();
        this.saveCurrentMap();
        this.renderMapList();
        if (pid) setTimeout(() => this.focusNode(pid), 20);
    },

    deleteSelectedNode() {
        if (!this.selectedId) return;
        const node = this.nodes.find(n => n.id === this.selectedId);
        if (!node) return;
        this._tryDeleteNode(node);
    },

    focusNode(id) {
        const el = document.getElementById(id);
        if (el) { el.focus(); document.execCommand('selectAll', false, null); }
    },

    _enterEditMode(id) {
        const el = document.getElementById(id);
        if (!el) return;
        // ドラッグ状態を強制リセット
        this.pointer.down = false;
        this.pointer.isDragging = false;
        this.pointer.type = null;
        this.pointer.node = null;
        // 編集モードON
        el.contentEditable = 'true';
        el.style.cursor = 'text';
        el.focus();
        // テキスト全選択
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    },

    _applyTransform() {
        this.dom.world.style.transform =
            `translate(${this.view.tx}px, ${this.view.ty}px) scale(${this.view.scale})`;
    },

    zoom(d) {
        const s = this.view.scale + d;
        if (s > 0.2 && s < 4) { this.view.scale = s; this._applyTransform(); }
    },
    resetZoom() { this.view.scale = 1; this.centerMap(); },

    // 文字サイズを変更する関数（再定義）
    changeFontSize(delta) {
        if (!this.selectedId) return; // 選択されていない場合は無視
        const node = this.nodes.find(n => n.id === this.selectedId);
        if (node) {
            // 数値として確実に加算（未定義なら14をデフォルトにする）
            const currentSize = parseInt(node.fontSize) || 14;
            node.fontSize = currentSize + delta;

            // 最小・最大制限
            if (node.fontSize < 8) node.fontSize = 8;
            if (node.fontSize > 100) node.fontSize = 100;

            console.log(`Node ${node.id} fontSize changed to: ${node.fontSize}`); // デバッグ用

            this.saveCurrentMap(); // ストレージに保存
            this.render(); // ★画面と線を再描画

            // フォーカス復帰（必要なら）
            requestAnimationFrame(() => {
                const el = document.getElementById(this.selectedId);
                if (el) el.focus();
            });
        }
    },

    centerMap() {
        this.view.tx = this.dom.viewport.offsetWidth / 2 - 100;
        this.view.ty = this.dom.viewport.offsetHeight / 2;
        this._applyTransform();
    },

    // ==========================================================
    //  JSON Import / Export
    // ==========================================================
    exportJSON() {
        const data = JSON.parse(JSON.stringify(this.nodes));
        const roots = data.filter(n => n.parentId === null);
        const name = roots.length > 0 ? roots[0].text.replace(/[^a-zA-Z0-9\u3040-\u9FFF]/g, '_') : 'mindmap';
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    },

    importJSON(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (!Array.isArray(data) || data.length === 0) {
                    alert('無効なデータ形式です。ノード配列が必要です。');
                    return;
                }
                // fontSize が無いノードにデフォルト値を設定
                data.forEach(n => { if (!n.fontSize) n.fontSize = 14; });

                // 新しいマップとして読み込み
                if (this.store.currentMapId) this.saveCurrentMap();
                const id = 'map-' + Date.now();
                const roots = data.filter(n => n.parentId === null);
                const title = roots.length > 0 ? roots[0].text : 'Imported';
                this.store.maps[id] = { title, data, lastModified: Date.now() };
                this.switchMap(id);
            } catch (err) {
                alert('JSONの読み込みに失敗しました: ' + err.message);
            }
        };
        reader.readAsText(file);
        // input をリセット（同じファイルを再選択可能に）
        event.target.value = '';
    },
};

app.init();
window.app = app; // グローバル公開してHTMLから呼べるようにする