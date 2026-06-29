/**
 * 云端同步配置（复制本文件为 cloud-config.js 并填入真实值）
 *
 * 1. 在 https://supabase.com 创建免费项目
 * 2. 执行 supabase-schema.sql 初始化表结构
 * 3. Authentication → Providers → Email：关闭 Confirm email（方便内网账号快速注册）
 * 4. Project Settings → API：复制 URL 和 anon public key
 */
window.CLOUD_CONFIG = {
    enabled: true,
    supabaseUrl: 'https://jimxmdbfzfinaotjontu.supabase.co',
    supabaseAnonKey: 'sb_publishable_Hgyb08BoXxowoYkIdWmtSQ_K4WWVTiN',
    // 登录时将手机号映射为邮箱（如 13800138000@sospace.local）
    emailDomain: 'sospace.local',
    // 未配置云端时，本地可仅使用浏览器存储（不连 Supabase）
    allowOfflineFallback: true,
    // 注册是否必须邀请码（暂时关闭）
    requireInviteCode: false
};
