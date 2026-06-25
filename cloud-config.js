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
    // 登录时将用户名映射为邮箱（用户只需记用户名）
    emailDomain: 'sospace.local',
    // 默认工作区（联盟共用同一 workspace 即可协作编辑）
    defaultWorkspace: '2607',
    // 未配置云端时是否允许本地离线模式（硬编码账号）
    allowOfflineFallback: true
};
