/**
 * 轻量云端同步 - 纯 fetch 实现，无 SDK 依赖
 * 依赖 Supabase Auth + PostgreSQL JSONB（免费层 500MB）
 */
(function (global) {
    'use strict';

    const CloudSync = {
        config: null,
        session: null,
        workspaceId: 'default',
        saveTimer: null,
        savePending: false,
        lastCloudSave: null,
        onStatusChange: null,

        init(config) {
            this.config = config || global.CLOUD_CONFIG || null;
            const saved = sessionStorage.getItem('cloudSession');
            if (saved) {
                try {
                    this.session = JSON.parse(saved);
                } catch (e) {
                    sessionStorage.removeItem('cloudSession');
                }
            }
            const ws = sessionStorage.getItem('cloudWorkspace');
            if (ws) this.workspaceId = ws;
            return this.isEnabled();
        },

        isEnabled() {
            const c = this.config;
            return !!(c && c.enabled && c.supabaseUrl && c.supabaseAnonKey
                && !c.supabaseUrl.includes('YOUR_PROJECT'));
        },

        isLoggedIn() {
            return !!(this.session && this.session.access_token);
        },

        usernameToEmail(username) {
            const domain = (this.config && this.config.emailDomain) || 'sospace.local';
            if (username.includes('@')) return username;
            return `${username}@${domain}`;
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
                const msg = (body && body.msg) || (body && body.error_description)
                    || (body && body.message) || (typeof body === 'string' ? body : res.statusText);
                throw new Error(msg || '请求失败');
            }
            return body;
        },

        _saveSession(session) {
            this.session = session;
            sessionStorage.setItem('cloudSession', JSON.stringify(session));
            sessionStorage.setItem('loggedIn', 'true');
        },

        async signUp(username, password) {
            const email = this.usernameToEmail(username);
            const body = await this._fetch('/auth/v1/signup', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            if (body.access_token) {
                this._saveSession(body);
                return body;
            }
            if (body.user && !body.session) {
                throw new Error('注册成功，请在 Supabase 关闭邮箱验证后重试登录');
            }
            return body;
        },

        async signIn(username, password) {
            const email = this.usernameToEmail(username);
            const body = await this._fetch('/auth/v1/token?grant_type=password', {
                method: 'POST',
                body: JSON.stringify({ email, password })
            });
            this._saveSession(body);
            return body;
        },

        signOut() {
            this.session = null;
            sessionStorage.removeItem('cloudSession');
            sessionStorage.removeItem('loggedIn');
        },

        setWorkspace(id) {
            this.workspaceId = (id || 'default').trim() || 'default';
            sessionStorage.setItem('cloudWorkspace', this.workspaceId);
        },

        async loadLayout() {
            if (!this.isLoggedIn()) return null;
            this.setStatus('loading', '正在加载云端数据…');
            try {
                const rows = await this._fetch(
                    `/rest/v1/workspaces?id=eq.${encodeURIComponent(this.workspaceId)}&select=data,updated_at`,
                    { method: 'GET', headers: { Accept: 'application/json' } }
                );
                if (rows && rows.length > 0) {
                    this.setStatus('ok', '已从云端加载');
                    return rows[0].data;
                }
                this.setStatus('ok', '新工作区，使用空白布局');
                return null;
            } catch (e) {
                this.setStatus('error', '云端加载失败: ' + e.message);
                throw e;
            }
        },

        async saveLayout(data) {
            if (!this.isLoggedIn()) return false;
            this.setStatus('saving', '保存中…');
            try {
                const payload = { id: this.workspaceId, data };
                await this._fetch('/rest/v1/workspaces', {
                    method: 'POST',
                    headers: {
                        Prefer: 'resolution=merge-duplicates,return=minimal'
                    },
                    body: JSON.stringify(payload)
                });
                this.lastCloudSave = Date.now();
                this.setStatus('ok', '已同步云端');
                return true;
            } catch (e) {
                this.setStatus('error', '云端保存失败: ' + e.message);
                console.warn('Cloud save failed:', e);
                return false;
            }
        },

        saveLayoutKeepalive(data) {
            if (!this.isLoggedIn()) return;
            const c = this.config;
            fetch(`${c.supabaseUrl}/rest/v1/workspaces`, {
                method: 'POST',
                keepalive: true,
                headers: {
                    apikey: c.supabaseAnonKey,
                    Authorization: `Bearer ${this.session.access_token}`,
                    'Content-Type': 'application/json',
                    Prefer: 'resolution=merge-duplicates,return=minimal'
                },
                body: JSON.stringify({ id: this.workspaceId, data })
            }).catch(() => {});
        },

        scheduleSave(data, delayMs) {
            if (!this.isEnabled() || !this.isLoggedIn()) return;
            clearTimeout(this.saveTimer);
            this.savePending = true;
            this.saveTimer = setTimeout(async () => {
                this.savePending = false;
                await this.saveLayout(data);
            }, delayMs || 2000);
        },

        flushSave(data) {
            if (!this.isEnabled() || !this.isLoggedIn()) return Promise.resolve(false);
            clearTimeout(this.saveTimer);
            this.savePending = false;
            this.saveLayoutKeepalive(data);
            return this.saveLayout(data);
        }
    };

    global.CloudSync = CloudSync;
})(typeof window !== 'undefined' ? window : this);
