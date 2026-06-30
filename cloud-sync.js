/**
 * 轻量云端同步 - 纯 fetch 实现，无 SDK 依赖
 */
(function (global) {
    'use strict';

    const CloudSync = {
        config: null,
        session: null,
        workspaceId: null,
        personalWorkspaceId: null,
        workspaceRole: null,
        accessMode: 'edit',
        saveTimer: null,
        savePending: false,
        onStatusChange: null,

        validateConfig(c) {
            if (!c) return '未读取到 cloud-config.js';
            if (!c.enabled) return 'cloud-config.js 中 enabled 须为 true';
            if (!c.supabaseUrl || String(c.supabaseUrl).includes('YOUR_PROJECT')) {
                return '请在 cloud-config.js 填写 supabaseUrl';
            }
            const key = c.supabaseAnonKey || c.supabaseKey;
            if (!key || String(key).includes('YOUR_ANON')) {
                return '请在 cloud-config.js 填写 supabaseAnonKey';
            }
            return null;
        },

        init(config) {
            this.config = config || global.CLOUD_CONFIG || null;
            const saved = sessionStorage.getItem('cloudSession');
            if (saved) {
                try { this.session = JSON.parse(saved); } catch (e) {
                    sessionStorage.removeItem('cloudSession');
                }
            }
            const ws = sessionStorage.getItem('cloudWorkspace');
            if (ws) this.workspaceId = ws;
            const role = sessionStorage.getItem('cloudWorkspaceRole');
            if (role) this.workspaceRole = role;
            const mode = sessionStorage.getItem('cloudWorkspaceMode');
            if (mode) this.accessMode = mode;
            return this.isEnabled();
        },

        canEdit() {
            if (!this.isLoggedIn() || !this.workspaceId) return true;
            if (this.workspaceId === this.personalWorkspaceId) return true;
            return this.workspaceRole === 'owner' || this.workspaceRole === 'editor';
        },

        isViewer() {
            return this.workspaceRole === 'viewer';
        },

        setWorkspaceAccess(role, accessMode) {
            this.workspaceRole = role || null;
            this.accessMode = accessMode || 'edit';
            if (role) sessionStorage.setItem('cloudWorkspaceRole', role);
            else sessionStorage.removeItem('cloudWorkspaceRole');
            sessionStorage.setItem('cloudWorkspaceMode', this.accessMode);
        },

        async syncWorkspaceAccess() {
            if (!this.isLoggedIn() || !this.workspaceId) return;
            try {
                const list = await this.listWorkspaces();
                const cur = list.find(w => w.workspace_id === this.workspaceId);
                if (cur) {
                    this.setWorkspaceAccess(cur.role, cur.access_mode || 'edit');
                    return;
                }
                if (this.workspaceId === this.personalWorkspaceId) {
                    this.setWorkspaceAccess('owner', 'edit');
                }
            } catch (e) {
                console.warn('syncWorkspaceAccess failed', e);
            }
        },

        isEnabled() {
            return this.validateConfig(this.config) === null;
        },

        isLoggedIn() {
            return !!(this.session && this.session.access_token);
        },

        usernameToEmail(username) {
            const domain = (this.config && this.config.emailDomain) || 'sospace.local';
            const input = String(username || '').trim();
            if (input.includes('@')) return input;
            const digits = input.replace(/\D/g, '');
            return `${digits || input}@${domain}`;
        },

        setStatus(status, message) {
            if (typeof this.onStatusChange === 'function') {
                this.onStatusChange(status, message);
            }
        },

        async _fetch(path, options = {}) {
            const c = this.config;
            const headers = {
                apikey: c.supabaseAnonKey,
                'Content-Type': 'application/json',
                ...(options.headers || {})
            };
            if (this.session && this.session.access_token) {
                headers.Authorization = `Bearer ${this.session.access_token}`;
            }
            const res = await fetch(`${c.supabaseUrl}${path}`, { ...options, headers });
            const text = await res.text();
            let body = null;
            if (text) {
                try { body = JSON.parse(text); } catch (e) { body = text; }
            }
            if (!res.ok) {
                const msg = (body && (body.msg || body.message || body.error_description))
                    || (body && body.hint) || (typeof body === 'string' ? body : res.statusText);
                const err = new Error(msg || '请求失败 (' + res.status + ')');
                if (body && body.error_code) err.code = body.error_code;
                throw err;
            }
            return body;
        },

        _saveSession(session) {
            this.session = session;
            sessionStorage.setItem('cloudSession', JSON.stringify(session));
            sessionStorage.setItem('loggedIn', 'true');
        },

        async validateInviteCode(code) {
            if (!code || !this.isEnabled()) return false;
            try {
                return await this._fetch('/rest/v1/rpc/validate_invite_code', {
                    method: 'POST',
                    body: JSON.stringify({ invite_code: code.trim() })
                }) === true;
            } catch (e) { return false; }
        },

        async consumeInviteCode(code) {
            if (!code || !this.isLoggedIn()) return false;
            try {
                return await this._fetch('/rest/v1/rpc/consume_invite_code', {
                    method: 'POST',
                    body: JSON.stringify({ invite_code: code.trim() })
                }) === true;
            } catch (e) { return false; }
        },

        async signUp(username, password, inviteCode) {
            const cfg = this.config || {};
            if (cfg.requireInviteCode === true) {
                if (!inviteCode || !inviteCode.trim()) throw new Error('请输入邀请码');
                if (!await this.validateInviteCode(inviteCode)) {
                    throw new Error('邀请码无效、已使用或已过期');
                }
            }
            const body = await this._fetch('/auth/v1/signup', {
                method: 'POST',
                body: JSON.stringify({ email: this.usernameToEmail(username), password })
            });
            if (body.access_token) {
                this._saveSession(body);
                if (cfg.requireInviteCode === true && inviteCode) {
                    if (!await this.consumeInviteCode(inviteCode)) {
                        this.signOut();
                        throw new Error('邀请码消耗失败');
                    }
                }
                return body;
            }
            if (body.user && !body.session) {
                throw new Error('注册成功，请关闭邮箱验证后登录');
            }
            return body;
        },

        async signIn(username, password) {
            const body = await this._fetch('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: JSON.stringify({ email: this.usernameToEmail(username), password })
            });
            this._saveSession(body);
            return body;
        },

        signOut() {
            this.session = null;
            this.workspaceId = null;
            this.personalWorkspaceId = null;
            this.workspaceRole = null;
            this.accessMode = 'edit';
            sessionStorage.removeItem('cloudSession');
            sessionStorage.removeItem('loggedIn');
            sessionStorage.removeItem('cloudWorkspace');
            sessionStorage.removeItem('cloudWorkspaceRole');
            sessionStorage.removeItem('cloudWorkspaceMode');
        },

        setWorkspace(id) {
            this.workspaceId = id;
            sessionStorage.setItem('cloudWorkspace', id);
        },

        async ensurePersonalWorkspace() {
            const id = await this._fetch('/rest/v1/rpc/ensure_personal_workspace', {
                method: 'POST',
                body: '{}'
            });
            this.personalWorkspaceId = id;
            if (!this.workspaceId) this.setWorkspace(id);
            return id;
        },

        getUserId() {
            if (!this.session || !this.session.access_token) return null;
            try {
                const payload = JSON.parse(atob(this.session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                return payload.sub || null;
            } catch (e) { return null; }
        },

        _normalizeWorkspaceList(result) {
            if (Array.isArray(result)) return result;
            if (typeof result === 'string') {
                try {
                    const parsed = JSON.parse(result);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (e) { return []; }
            }
            return [];
        },

        async listWorkspacesFallback() {
            const uid = this.getUserId();
            const rows = await this._fetch(
                '/rest/v1/workspace_members?select=workspace_id,role,joined_at,workspaces(id,share_code,label,is_personal,updated_at,owner_id,access_mode,view_token)',
                { method: 'GET', headers: { Accept: 'application/json' } }
            );
            if (!Array.isArray(rows)) return [];
            return rows.map(rm => {
                const w = rm.workspaces || {};
                const role = rm.role || 'editor';
                return {
                    workspace_id: rm.workspace_id,
                    share_code: w.share_code,
                    label: w.label,
                    is_personal: !!w.is_personal,
                    access_mode: w.access_mode || 'edit',
                    view_token: uid && w.owner_id === uid ? w.view_token : null,
                    role,
                    can_edit: role === 'owner' || role === 'editor',
                    is_owner: uid ? w.owner_id === uid : false,
                    updated_at: w.updated_at,
                    joined_at: rm.joined_at
                };
            }).sort((a, b) => {
                if (a.is_personal !== b.is_personal) return a.is_personal ? -1 : 1;
                return new Date(b.joined_at || 0) - new Date(a.joined_at || 0);
            });
        },

        async listWorkspaces() {
            try {
                const result = await this._fetch('/rest/v1/rpc/list_workspaces', {
                    method: 'POST',
                    body: '{}'
                });
                const list = this._normalizeWorkspaceList(result);
                if (list.length > 0) return list;
            } catch (e) {
                console.warn('[云端] list_workspaces RPC 失败，尝试备用查询', e);
            }
            try {
                return await this.listWorkspacesFallback();
            } catch (e) {
                console.error('[云端] 工作区列表备用查询也失败', e);
                throw e;
            }
        },

        async createSharedWorkspace(label, password, sourceWorkspaceId, accessMode) {
            const body = await this._fetch('/rest/v1/rpc/create_shared_workspace', {
                method: 'POST',
                body: JSON.stringify({
                    p_label: label || '',
                    p_password: password,
                    p_source_workspace_id: sourceWorkspaceId || this.workspaceId,
                    p_access_mode: accessMode || 'edit'
                })
            });
            if (body && typeof body === 'object' && body.share_code) {
                return { shareCode: body.share_code, viewToken: body.view_token || null };
            }
            const code = typeof body === 'string' ? body.replace(/^"|"$/g, '') : String(body || '');
            return { shareCode: code, viewToken: null };
        },

        async fetchViewShare(viewToken, password) {
            return await this._fetch('/rest/v1/rpc/fetch_view_share', {
                method: 'POST',
                body: JSON.stringify({
                    p_view_token: viewToken,
                    p_password: password
                })
            });
        },

        async joinByCode(shareCode, password) {
            const code = String(shareCode || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            if (code.length !== 12) throw new Error('分享码必须为 12 位');
            const result = await this._fetch('/rest/v1/rpc/join_workspace_by_code', {
                method: 'POST',
                body: JSON.stringify({ p_share_code: code, p_password: password })
            });
            if (result === true) return true;
            throw new Error('加入失败，请检查分享码和密码');
        },

        async updateWorkspacePassword(workspaceId, newPassword) {
            return await this._fetch('/rest/v1/rpc/update_workspace_password', {
                method: 'POST',
                body: JSON.stringify({
                    p_workspace_id: workspaceId,
                    p_new_password: newPassword
                })
            }) === true;
        },

        async removeWorkspace(workspaceId) {
            return await this._fetch('/rest/v1/rpc/remove_workspace', {
                method: 'POST',
                body: JSON.stringify({ p_workspace_id: workspaceId })
            }) === true;
        },

        async loadLayout() {
            if (!this.isLoggedIn() || !this.workspaceId) return null;
            this.setStatus('loading', '正在加载云端数据…');
            try {
                const rows = await this._fetch(
                    `/rest/v1/workspaces?id=eq.${encodeURIComponent(this.workspaceId)}&select=data,updated_at,label,share_code,is_personal`,
                    { method: 'GET', headers: { Accept: 'application/json' } }
                );
                if (rows && rows.length > 0) {
                    await this.syncWorkspaceAccess();
                    const label = rows[0].label || this.workspaceId;
                    const modeHint = this.isViewer() ? '（只读）' : '';
                    this.setStatus('ok', '已同步: ' + label + modeHint);
                    return rows[0].data;
                }
                this.setStatus('ok', '空白工作区');
                return null;
            } catch (e) {
                this.setStatus('error', '加载失败: ' + e.message);
                throw e;
            }
        },

        async loadLayoutMeta() {
            if (!this.isLoggedIn() || !this.workspaceId) return null;
            try {
                const rows = await this._fetch(
                    `/rest/v1/workspaces?id=eq.${encodeURIComponent(this.workspaceId)}&select=data,updated_at`,
                    { method: 'GET', headers: { Accept: 'application/json' } }
                );
                return rows && rows[0] ? rows[0] : null;
            } catch (e) {
                console.warn('[云端] loadLayoutMeta 失败', e);
                return null;
            }
        },

        async saveLayout(data) {
            if (!this.isLoggedIn() || !this.workspaceId) return false;
            if (!this.canEdit()) {
                this.setStatus('ok', '只读工作区（未保存）');
                return false;
            }
            this.setStatus('saving', '保存中…');
            try {
                await this._fetch('/rest/v1/workspaces?id=eq.' + encodeURIComponent(this.workspaceId), {
                    method: 'PATCH',
                    headers: { Prefer: 'return=minimal' },
                    body: JSON.stringify({ data })
                });
                this.setStatus('ok', '已同步云端');
                return true;
            } catch (e) {
                this.setStatus('error', '保存失败: ' + e.message);
                console.warn('Cloud save failed:', e);
                return false;
            }
        },

        saveLayoutKeepalive(data) {
            if (!this.isLoggedIn() || !this.workspaceId) return;
            const c = this.config;
            fetch(`${c.supabaseUrl}/rest/v1/workspaces?id=eq.${encodeURIComponent(this.workspaceId)}`, {
                method: 'PATCH',
                keepalive: true,
                headers: {
                    apikey: c.supabaseAnonKey,
                    Authorization: `Bearer ${this.session.access_token}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal'
                },
                body: JSON.stringify({ data })
            }).catch(() => {});
        },

        scheduleSave(data, delayMs) {
            if (!this.isEnabled() || !this.isLoggedIn() || !this.workspaceId || !this.canEdit()) return;
            clearTimeout(this.saveTimer);
            this.saveTimer = setTimeout(async () => {
                await this.saveLayout(data);
            }, delayMs || 2000);
        },

        flushSave(data) {
            if (!this.isEnabled() || !this.isLoggedIn() || !this.workspaceId) return Promise.resolve(false);
            if (!this.canEdit()) return Promise.resolve(false);
            clearTimeout(this.saveTimer);
            this.saveLayoutKeepalive(data);
            return this.saveLayout(data);
        }
    };

    global.CloudSync = CloudSync;
})(typeof window !== 'undefined' ? window : this);
