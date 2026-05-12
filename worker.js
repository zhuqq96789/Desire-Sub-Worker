// ==========================================
// 全局配置与预设
// ==========================================
const PAGE_SIZE = 30;
const BATCH_SIZE = 50;
const MAX_IPS = 1000; 
const CACHE_TTL = 60;
const STATS_CACHE_KEY = 'cache:stats';
const TASK_TTL = 300; 

const REGIONS = ['HK', '香港', 'TW', '台湾', 'JP', '日本', 'SG', '新加坡', 'KR', '韩国', 'US', '美国'];
const REGION_ORDER = new Map(REGIONS.map((r, i) => [r, i]));
const UNKNOWN_REGION_INDEX = REGIONS.length;
const REGION_PATTERNS = REGIONS.map(r => `(${r})`).join('|');
const COMBINED_REGION_REGEX = new RegExp(REGION_PATTERNS, 'i');
const IP_FORMAT_REGEX = /^(\[[a-fA-F0-9:]+\]|[^:#\[\]]+)(?::(\d+))?(#.*)?$/;

// Clash 订阅后端 API 配置
const CLASH_API_URL = "https://api.v1.mk/sub";
const CLASH_RULE_URL = "https://raw.githubusercontent.com/zhuqq2020/Mihomo-Party-ACL4SSR/refs/heads/ACL4SSR/ACL4SSR_Online_Full_MultiMode_Cloudflare.ini";

// ==========================================
// 核心工具函数
// ==========================================
const json = (d, s = 200) => Response.json(d, { status: s });
const err = (m, s = 400) => Response.json({ error: m }, { status: s });
const encodeBase64 = (str) => btoa(unescape(encodeURIComponent(str)));
const decodeBase64 = (str) => decodeURIComponent(escape(atob(str)));

// 生成伪装错误节点
const createErrorNode = (msg) => {
    return `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:80?encryption=none&security=none&type=tcp#${encodeURIComponent(msg)}`;
};

// 生成 Clash 格式的错误配置
const createErrorClashConfig = (msg) => {
    return `# Clash 配置文件生成失败
# 错误信息: ${msg}
# 请检查您的订阅配置

proxies:
  - name: "❌ 订阅生成失败: ${msg}"
    type: vless
    server: 127.0.0.1
    port: 80
    uuid: 00000000-0000-0000-0000-000000000000
    udp: false
    tls: false
    skip-cert-verify: true

proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "❌ 订阅生成失败: ${msg}"

rules:
  - MATCH,PROXY
`;
};

// 计算本月已过天数百分比（按30天一个月计算）
const getMonthProgressPercent = () => {
    const now = new Date();
    const dayOfMonth = now.getDate();
    const effectiveDays = Math.min(dayOfMonth, 30);
    const progressPercent = (effectiveDays / 30) * 100;
    return progressPercent;
};

// 根据百分比动态计算已用流量
const calculateDynamicTraffic = (totalTraffic) => {
    const progressPercent = getMonthProgressPercent();
    const usedTraffic = (totalTraffic * progressPercent) / 100;
    return {
        used: usedTraffic,
        percent: progressPercent,
        remaining: totalTraffic - usedTraffic,
        upload: Math.floor(usedTraffic),
        download: 0
    };
};

// 生成带流量信息的 Clash 配置头部
const generateClashHeader = (userInfo, host) => {
    const now = new Date();
    const expireDate = userInfo.expireTime ? new Date(userInfo.expireTime) : null;
    
    let header = `#---------------------------------------------------#
#              ${host}_CF优选订阅
#---------------------------------------------------#
# 更新时间: ${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
`;

    if (userInfo.total) {
        const total = userInfo.total;
        const dynamicTraffic = calculateDynamicTraffic(total);
        const usedPercent = dynamicTraffic.percent.toFixed(1);
        
        header += `#---------------------------------------------------#
# 流量信息（动态计算）:
#   总流量: ${formatBytes(total)}
#   本月已用: ${formatBytes(dynamicTraffic.used)} / ${formatBytes(total)} (${usedPercent}%)
#   本月剩余: ${formatBytes(dynamicTraffic.remaining)}
`;
    }
    
    if (expireDate && !isNaN(expireDate.getTime())) {
        const daysLeft = Math.ceil((expireDate - now) / (1000 * 60 * 60 * 24));
        header += `#   到期时间: ${expireDate.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
#   剩余天数: ${daysLeft} 天
`;
    }
    
    if (userInfo.plan) {
        header += `#   套餐名称: ${userInfo.plan}
`;
    }
    
    header += `#---------------------------------------------------#
`;
    
    return header;
};

// 格式化字节数
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// 解析 IP
const parseIP = (ip) => {
    if (!ip) return { displayIp: '', port: '443', name: '' };
    const match = ip.match(IP_FORMAT_REGEX);
    if (!match) return { displayIp: ip, port: '443', name: '' };
    return {
        displayIp: match[1],
        port: match[2] || '443',
        name: (match[3] || '').slice(1),
    };
};

const extractRegion = (name) => {
    if (!name) return '';
    const match = name.match(COMBINED_REGION_REGEX);
    return match ? match[0].toUpperCase() : '';
};
const getRegionIndex = (region) => region ? (REGION_ORDER.get(region) ?? UNKNOWN_REGION_INDEX) : UNKNOWN_REGION_INDEX;

// 检测客户端类型
const detectClientType = (userAgent) => {
    if (!userAgent) return 'v2ray';
    const ua = userAgent.toLowerCase();
    if (ua.includes('clash') || ua.includes('mihomo') || ua.includes('cfw') || 
        ua.includes('clashx') || ua.includes('clash-verge') || ua.includes('clash.meta') ||
        ua.includes('clashmeta')) {
        return 'clash';
    }
    return 'standard';
};

// 从基础节点链接中提取真实的 host 地址
const extractHostFromBaseLink = (baseLink) => {
    if (!baseLink) return 'SPGCC';
    
    try {
        if (baseLink.startsWith('vless://') || baseLink.startsWith('trojan://')) {
            const url = new URL(baseLink);
            let host = url.searchParams.get('sni');
            if (!host) host = url.searchParams.get('host');
            if (!host) host = url.hostname;
            return host;
        } 
        else if (baseLink.startsWith('vmess://')) {
            const b64 = baseLink.slice(8).replace(/-/g, '+').replace(/_/g, '/');
            const config = JSON.parse(decodeBase64(b64));
            return config.sni || config.host || config.add || 'SPGCC';
        }
    } catch (e) {
        console.error('提取 host 失败:', e);
    }
    
    return 'SPGCC';
};

// 构建带 Token 的订阅 URL
const buildSubscriptionUrl = (baseUrl, baseLink, source, extUrl, token) => {
    const url = new URL(baseUrl);
    url.searchParams.set('base', baseLink);
    if (token) url.searchParams.set('token', token);
    if (source === 'ext' && extUrl) {
        url.searchParams.set('source', source);
        url.searchParams.set('ext_url', extUrl);
    }
    return url.toString();
};

// 获取用户流量信息
const getUserTrafficInfo = async (kv, token) => {
    if (kv && token) {
        const userData = await kv.get(`user:${token}`);
        if (userData) {
            return JSON.parse(userData);
        }
    }
    
    return {
        plan: "SPGCC 优选套餐",
        total: 1000 * 1024 * 1024 * 1024,
        expireTime: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString(),
    };
};

// 生成 Subscription-UserInfo 响应头
const generateSubscriptionUserInfo = (userInfo) => {
    if (!userInfo.total) return null;
    
    const dynamicTraffic = calculateDynamicTraffic(userInfo.total);
    const expireTimestamp = userInfo.expireTime ? Math.floor(new Date(userInfo.expireTime).getTime() / 1000) : 0;
    
    return `upload=${dynamicTraffic.upload}; download=${dynamicTraffic.download}; total=${Math.floor(userInfo.total)}; expire=${expireTimestamp}`;
};

// 生成 Content-Disposition 文件名（RFC 2231 编码）
const encodeContentDisposition = (filename) => {
    const encodedFilename = encodeURIComponent(filename).replace(/['()]/g, escape).replace(/\*/g, '%2A');
    return `attachment; filename*=UTF-8''${encodedFilename}; filename="${filename.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}"`;
};

// 将节点列表转换为 Clash 配置
const convertToClashConfig = async (subscriptionUrl, apiUrl, ruleUrl, userInfo, host) => {
    try {
        const convertUrl = new URL(apiUrl);
        convertUrl.searchParams.set('target', 'clash');
        convertUrl.searchParams.set('url', subscriptionUrl);
        convertUrl.searchParams.set('config', ruleUrl);
        convertUrl.searchParams.set('include', '');
        convertUrl.searchParams.set('exclude', '');
        convertUrl.searchParams.set('emoji', 'true');
        convertUrl.searchParams.set('udp', 'true');
        
        console.log('Converting to clash config:', convertUrl.toString());
        
        const response = await fetch(convertUrl.toString(), {
            method: 'GET',
            headers: {
                'User-Agent': 'Clash-Client/1.0',
                'Accept': 'text/yaml,text/plain,*/*'
            }
        });
        
        if (!response.ok) {
            throw new Error(`API 请求失败: ${response.status} ${response.statusText}`);
        }
        
        let clashConfig = await response.text();
        
        if (clashConfig.includes('订阅生成失败') || clashConfig.includes('❌')) {
            throw new Error('订阅转换返回了错误配置');
        }
        
        const header = generateClashHeader(userInfo, host);
        clashConfig = header + '\n' + clashConfig;
        
        return clashConfig;
    } catch (error) {
        console.error('Clash 转换失败:', error);
        return createErrorClashConfig(error.message);
    }
};

// ==========================================
// 核心订阅引擎：链接裂变拼接
// ==========================================
const multiplexLink = (baseLink, premiumIpRow) => {
    const { displayIp, port, name } = parseIP(premiumIpRow.ip);
    const nodeName = premiumIpRow.name || name || displayIp;

    try {
        if (baseLink.startsWith('vless://') || baseLink.startsWith('trojan://')) {
            const url = new URL(baseLink);
            const originalHost = url.hostname;
            url.hostname = displayIp;
            if (port && port !== 'N/A') url.port = port;
            
            url.hash = nodeName;
            
            if (!url.searchParams.has('host') && originalHost) url.searchParams.set('host', originalHost);
            if (!url.searchParams.has('sni') && originalHost) url.searchParams.set('sni', originalHost);
            return url.toString();
        } 
        else if (baseLink.startsWith('vmess://')) {
            const b64 = baseLink.slice(8).replace(/-/g, '+').replace(/_/g, '/');
            const config = JSON.parse(decodeBase64(b64));
            if (!config.sni) config.sni = config.add;
            if (!config.host) config.host = config.add;
            config.add = displayIp;
            if (port && port !== 'N/A') config.port = parseInt(port);
            config.ps = nodeName; 
            return 'vmess://' + encodeBase64(JSON.stringify(config));
        }
    } catch (e) {
        return null;
    }
    return null;
};

// ==========================================
// 数据库与任务缓存管理
// ==========================================
const taskCache = new Map();
const execBatches = async (db, statements) => {
    const len = statements.length;
    if (len === 0) return;
    for (let i = 0; i < len; i += BATCH_SIZE) {
        await db.batch(statements.slice(i, Math.min(i + BATCH_SIZE, len)));
    }
};

const saveTask = async (kv, id, status, msg = '') => {
    const data = { status, message: msg, timestamp: Date.now() };
    taskCache.set(id, data);
    setTimeout(() => taskCache.delete(id), TASK_TTL * 1000);
    if (kv) await kv.put(`task:${id}`, JSON.stringify(data), { expirationTtl: TASK_TTL }).catch(() => {});
};

const getTask = async (kv, id) => {
    const cached = taskCache.get(id);
    if (cached) return cached;
    if (kv) {
        try {
            const data = await kv.get(`task:${id}`, { type: 'json' });
            if (data) { taskCache.set(id, data); return data; }
        } catch {}
    }
    return null;
};

const invalidateCache = async (kv) => { if (kv) await kv.delete(STATS_CACHE_KEY).catch(() => {}); };
const getCachedStats = async (kv) => {
    if (!kv) return null;
    try { return await kv.get(STATS_CACHE_KEY, { type: 'json' }); } catch { return null; }
};
const setCachedStats = async (kv, stats) => { if (kv) await kv.put(STATS_CACHE_KEY, JSON.stringify(stats), { expirationTtl: CACHE_TTL }).catch(() => {}); };

const performIdReorder = async (db, sortedIds) => {
    if (sortedIds.length === 0) return;
    const tempStmts = sortedIds.map((id, i) => db.prepare('UPDATE ips SET id = ? WHERE id = ?').bind(-(i + 1), id));
    const finalStmts = sortedIds.map((_, i) => db.prepare('UPDATE ips SET id = ? WHERE id = ?').bind(i + 1, -(i + 1)));
    await execBatches(db, tempStmts);
    await execBatches(db, finalStmts);
};

// ==========================================
// 后台 API 实现 
// ==========================================
const api = {
    async getIps(db, params) {
        const page = Math.max(1, parseInt(params.get('page')) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(params.get('limit')) || PAGE_SIZE));
        const offset = (page - 1) * limit;
        const needTotal = params.get('needTotal') === 'true';
        const keyword = params.get('keyword') || '';

        let baseQuery = 'FROM ips';
        const bindings = [];
        if (keyword) {
            baseQuery += ' WHERE ip LIKE ? OR name LIKE ?';
            bindings.push(`%${keyword}%`, `%${keyword}%`);
        }

        const queries = [
            db.prepare(`SELECT id, ip, name, active, priority ${baseQuery} ORDER BY id LIMIT ? OFFSET ?`)
              .bind(...bindings, limit, offset)
        ];

        if (needTotal) {
            queries.push(db.prepare(`SELECT COUNT(*) as total ${baseQuery}`).bind(...bindings));
        }

        const results = await db.batch(queries);
        const ips = results[0].results.map(r => {
            const { displayIp, port } = parseIP(r.ip);
            return { ...r, displayIp, port, region: extractRegion(r.name) };
        });

        const pagination = { page, limit };
        if (needTotal) {
            pagination.total = results[1].results[0].total;
            pagination.pages = Math.ceil(pagination.total / limit) || 1;
        }
        return json({ ips, pagination });
    },
    async getStats(db, kv) {
        const cached = await getCachedStats(kv);
        if (cached) return json(cached);
        const { total, active } = await db.prepare('SELECT COUNT(*) as total, SUM(active) as active FROM ips').first();
        const stats = { total, active: active || 0, inactive: total - (active || 0) };
        await setCachedStats(kv, stats);
        return json(stats);
    },
    async getTaskStatus(kv, taskId) {
        const task = await getTask(kv, taskId);
        return task ? json(task) : err('任务不存在或已过期', 404);
    },
    async addIp(db, { ip, priority }, kv) {
        if (!ip) return err('IP不能为空');
        const { displayIp, port, name } = parseIP(ip);
        if (port === 'N/A') return err('IP格式错误');
        
        let prio = priority;
        if (prio === undefined || prio === null) {
            const { n } = await db.prepare('SELECT COALESCE(MAX(priority), 0) + 1 as n FROM ips').first();
            prio = n;
        }

        const { meta } = await db.prepare('INSERT OR IGNORE INTO ips(ip, name, active, priority) VALUES(?, ?, 1, ?)')
            .bind(`${displayIp}:${port}`, name || null, prio).run();

        if (meta.changes === 0) return err('IP已存在');
        await invalidateCache(kv);
        return json({ success: true });
    },
    async batchImport(db, { ips }, ctx, kv) {
        if (!Array.isArray(ips) || !ips.length) return err('列表为空');
        const taskId = crypto.randomUUID();
        ctx.waitUntil((async () => {
            try {
                const parsed = ips.map(ip => {
                    const { displayIp, port, name } = parseIP(ip);
                    return port === 'N/A' ? null : { ip: `${displayIp}:${port}`, name: name || null };
                }).filter(Boolean);
                if (parsed.length === 0) return await saveTask(kv, taskId, 'completed', '没有有效的IP地址');

                const { p } = await db.prepare('SELECT COALESCE(MAX(priority), 0) as p FROM ips').first();
                const stmt = db.prepare('INSERT OR IGNORE INTO ips(ip, name, active, priority) VALUES(?, ?, 1, ?)');
                const batch = parsed.map((item, i) => stmt.bind(item.ip, item.name, p + i + 1));

                await execBatches(db, batch);
                await invalidateCache(kv);
                await saveTask(kv, taskId, 'completed', `成功导入 ${parsed.length} 条数据`);
            } catch (e) { await saveTask(kv, taskId, 'failed', e.message); }
        })());
        return json({ success: true, async: true, taskId, count: ips.length });
    },
    async batchDelete(db, { ips }, ctx, kv) {
        if (!Array.isArray(ips) || !ips.length) return err('列表为空');
        const taskId = crypto.randomUUID();
        ctx.waitUntil((async () => {
            try {
                const deleteIps = ips.map(line => {
                    let targetIp = line.trim();
                    if (targetIp.startsWith('vless://') || targetIp.startsWith('trojan://')) {
                        try {
                            const url = new URL(targetIp);
                            targetIp = `${url.hostname}:${url.port || '443'}`;
                            return targetIp;
                        } catch(e) {}
                    }
                    if (targetIp.startsWith('vmess://')) {
                        try {
                            const b64 = targetIp.slice(8).replace(/-/g, '+').replace(/_/g, '/');
                            const config = JSON.parse(decodeBase64(b64));
                            targetIp = `${config.add}:${config.port || '443'}`;
                            return targetIp;
                        } catch(e) {}
                    }
                    const { displayIp, port } = parseIP(targetIp);
                    return port === 'N/A' ? null : `${displayIp}:${port}`;
                }).filter(Boolean);

                if (deleteIps.length === 0) return await saveTask(kv, taskId, 'completed', '没有识别到有效的节点或IP进行删除');

                const batch = deleteIps.map(ip => db.prepare('DELETE FROM ips WHERE ip=?').bind(ip));
                await execBatches(db, batch);
                await invalidateCache(kv);
                await saveTask(kv, taskId, 'completed', `成功清理了 ${deleteIps.length} 条匹配的数据`);
            } catch (e) { await saveTask(kv, taskId, 'failed', e.message); }
        })());
        return json({ success: true, async: true, taskId, count: ips.length });
    },
    async clearAll(db, ctx, kv) {
        const taskId = crypto.randomUUID();
        ctx.waitUntil((async () => {
            try {
                await db.prepare('DELETE FROM ips').run();
                await invalidateCache(kv);
                await saveTask(kv, taskId, 'completed', '清空完成');
            } catch (e) { await saveTask(kv, taskId, 'failed', e.message); }
        })());
        return json({ success: true, async: true, taskId });
    },
    async toggleAll(db, { active }, ctx, kv) {
        const taskId = crypto.randomUUID();
        ctx.waitUntil((async () => {
            try {
                await db.prepare('UPDATE ips SET active = ?').bind(active ? 1 : 0).run();
                await invalidateCache(kv);
                await saveTask(kv, taskId, 'completed', '更新完成');
            } catch (e) { await saveTask(kv, taskId, 'failed', e.message); }
        })());
        return json({ success: true, async: true, taskId });
    },
    async updateIp(db, id, body, kv) {
        const { active, ip, priority } = body;
        const updates = [];
        if (ip !== undefined) {
            const { displayIp, port, name } = parseIP(ip);
            updates.push(db.prepare('UPDATE ips SET ip=?, name=? WHERE id=?').bind(`${displayIp}:${port}`, name || null, id));
        }
        if (active !== undefined) updates.push(db.prepare('UPDATE ips SET active=? WHERE id=?').bind(active ? 1 : 0, id));
        if (priority !== undefined) updates.push(db.prepare('UPDATE ips SET priority = ? WHERE id = ?').bind(priority, id));
        if (updates.length > 0) { await db.batch(updates); await invalidateCache(kv); }
        return json({ success: true });
    },
    async deleteIp(db, id, kv) {
        await db.prepare('DELETE FROM ips WHERE id=?').bind(id).run();
        await invalidateCache(kv);
        return json({ success: true });
    },
    async sortIps(db, ctx, kv) {
        const taskId = crypto.randomUUID();
        ctx.waitUntil((async () => {
            try {
                const { results } = await db.prepare('SELECT id, ip, name, priority FROM ips').all();
                const parsed = results.map(r => ({ ...r, region: extractRegion(r.name) }));
                parsed.sort((a, b) => getRegionIndex(a.region) - getRegionIndex(b.region) || a.priority - b.priority || a.id - b.id);
                await performIdReorder(db, parsed.map(s => s.id));
                await invalidateCache(kv);
                await saveTask(kv, taskId, 'completed', '排序完成');
            } catch (e) { await saveTask(kv, taskId, 'failed', e.message); }
        })());
        return json({ success: true, async: true, taskId });
    },
    async removeDuplicates(db, ctx, kv) {
        const taskId = crypto.randomUUID();
        ctx.waitUntil((async () => {
            try {
                const { results } = await db.prepare(`SELECT GROUP_CONCAT(id) as ids FROM ips GROUP BY SUBSTR(ip, 1, INSTR(ip, ':') - 1) HAVING COUNT(*) > 1`).all();
                const deleteIds = results.flatMap(r => r.ids.split(',').map(Number).sort((a, b) => a - b).slice(1));
                const batch = deleteIds.map(id => db.prepare('DELETE FROM ips WHERE id = ?').bind(id));
                await execBatches(db, batch);
                await invalidateCache(kv);
                await saveTask(kv, taskId, 'completed', `清理了 ${deleteIds.length} 条重复数据`);
            } catch (e) { await saveTask(kv, taskId, 'failed', e.message); }
        })());
        return json({ success: true, async: true, taskId });
    },
    async getUserInfo(kv, token) {
        const userInfo = await getUserTrafficInfo(kv, token);
        const dynamicTraffic = calculateDynamicTraffic(userInfo.total);
        return json({
            ...userInfo,
            dynamicTraffic: {
                usedPercent: dynamicTraffic.percent.toFixed(1),
                used: formatBytes(dynamicTraffic.used),
                remaining: formatBytes(dynamicTraffic.remaining),
                total: formatBytes(userInfo.total),
                dayOfMonth: new Date().getDate()
            }
        });
    },
    async updateUserInfo(kv, token, body) {
        const userInfo = await getUserTrafficInfo(kv, token);
        const updatedInfo = { ...userInfo, ...body };
        await kv.put(`user:${token}`, JSON.stringify(updatedInfo));
        return json({ success: true });
    }
};

const handleApiRoute = async (req, db, ctx, kv) => {
    const url = new URL(req.url);
    const path = url.pathname.slice(4);
    const method = req.method;
    try {
        const body = (method === 'POST' || method === 'PUT') ? await req.json().catch(() => ({})) : {};
        
        if (path === '/shorten' && method === 'POST') {
            const { longUrl } = body;
            if (!longUrl) return err('链接不能为空');
            const shortId = Math.random().toString(36).substring(2, 8);
            if (kv) {
                await kv.put(`short:${shortId}`, longUrl);
                return json({ success: true, shortId });
            }
            return err('未绑定 KV 空间', 500);
        }
        
        if (path === '/user/info' && method === 'GET') {
            const token = url.searchParams.get('token');
            if (!token) return err('缺少 token 参数');
            return api.getUserInfo(kv, token);
        }
        
        if (path === '/user/update' && method === 'POST') {
            const { token, ...updates } = body;
            if (!token) return err('缺少 token 参数');
            return api.updateUserInfo(kv, token, updates);
        }

        if (path === '/ips' && method === 'GET') return api.getIps(db, url.searchParams);
        if (path === '/ips' && method === 'POST') return api.addIp(db, body, kv);
        if (path === '/ips/stats') return api.getStats(db, kv);
        if (path === '/ips/batch') return api.batchImport(db, body, ctx, kv);
        if (path === '/ips/batch-delete') return api.batchDelete(db, body, ctx, kv);
        if (path === '/ips/clear' && method === 'DELETE') return api.clearAll(db, ctx, kv);
        if (path === '/ips/toggle-all') return api.toggleAll(db, body, ctx, kv);
        if (path === '/ips/sort') return api.sortIps(db, ctx, kv);
        if (path === '/ips/remove-duplicates') return api.removeDuplicates(db, ctx, kv);
        if (path.startsWith('/task/')) return api.getTaskStatus(kv, path.slice(6));
        
        const idMatch = path.match(/^\/ips\/(\d+)$/);
        if (idMatch) {
            if (method === 'PUT') return api.updateIp(db, idMatch[1], body, kv);
            if (method === 'DELETE') return api.deleteIp(db, idMatch[1], kv);
        }
        return new Response('Not Found', { status: 404 });
    } catch (e) { return err(e.message, 500); }
};

// ==========================================
// 前端 HTML 页面（保持不变）
// ==========================================
const getPublicHTML = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SPGCC优选订阅</title>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<style>
body { background-color: #1a1a2e; background-image: url('https://bing.ee123.net/img/rand'); background-size: cover; background-position: center; background-attachment: fixed; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
.card { background: rgba(44, 44, 44, 0.7); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px); padding: 40px; border-radius: 20px; width: 100%; max-width: 500px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); text-align: center; border: 1px solid rgba(255, 255, 255, 0.1); }
.avatar { width: 80px; height: 80px; border-radius: 50%; background: #fff; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; font-size: 40px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
h1 { font-size: 24px; margin-bottom: 40px; font-weight: 600; letter-spacing: 0.5px; text-shadow: 0 2px 4px rgba(0,0,0,0.5); font-style: italic; }
.form-group { text-align: left; margin-bottom: 20px; }
label { display: block; font-size: 14px; margin-bottom: 8px; color: #eaeaea; font-weight: 600; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
input, select { width: 100%; padding: 16px; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255,255,255,0.2); border-radius: 10px; color: #fff; font-size: 14px; box-sizing: border-box; transition: all 0.3s ease; }
input:focus, select:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); background: rgba(0, 0, 0, 0.6); }
input::placeholder { color: #aaa; }
select option { color: #000; background: #fff; }
button { width: 100%; padding: 16px; background: rgba(30, 58, 138, 0.85); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: all 0.3s; margin-bottom: 15px; backdrop-filter: blur(5px); }
button:hover { background: rgba(29, 78, 216, 0.95); transform: translateY(-1px); }
button:disabled { opacity: 0.7; cursor: not-allowed; }
.footer { margin-top: 30px; font-size: 12px; color: #bbb; line-height: 1.6; text-shadow: 0 1px 2px rgba(0,0,0,0.5); }
.tg-link { color: #58a6ff; text-decoration: none; font-weight: bold; transition: color 0.2s; }
.tg-link:hover { color: #79c0ff; text-decoration: underline; }
#qrWrap { display: none; justify-content: center; margin-top: 25px; animation: fadeIn 0.5s ease; }
#qrCodeBox { background: #fff; padding: 15px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.4); }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<div class="card">
    <div class="avatar"><img src="https://play-lh.googleusercontent.com/Y7sRltILft4Mt7fl1AT8eArOX8UijSAehcdzzSa1e5-hvi9TTzCMoYFQoEYL0fbpaJY=s128-rw" alt="Logo"></div>
    <h1>SPGCC优选订阅</h1>
    
    <div class="form-group">
        <label>基础节点链接</label>
        <input type="text" id="nodeLink" placeholder="请输入 VMess / VLESS / Trojan 链接" autocomplete="off">
    </div>

    <div class="form-group">
        <label>优选 IP 来源</label>
        <select id="ipSource" onchange="toggleExtInput()">
            <option value="local">本地私有优选库 (高稳定)</option>
            <option value="ext">外部公开优选库 (实时拉取)</option>
        </select>
    </div>

    <div class="form-group" id="extUrlGroup" style="display: none;">
        <label>外部优选库接口 (API 或 TXT)</label>
        <select id="extUrlSelect" onchange="document.getElementById('extUrl').value = this.value" style="margin-bottom: 8px;">
            <option value="https://cf.090227.xyz/ct?ips=100">📶 动态测速 API - 电信优选</option>
            <option value="https://cf.090227.xyz/cu?ips=100">📶 动态测速 API - 联通优选</option>
            <option value="https://cf.090227.xyz/cmcc?ips=100">📶 动态测速 API - 移动优选</option>
            <option value="https://cf.090227.xyz/CloudFlareYes">🌐 动态测速 API - 通用官方</option>
            <option value="https://raw.githubusercontent.com/zhuqq2020/CloudflareIP_NEW/refs/heads/main/All.txt">📦 静态 TXT 库 - 本人 (备用)</option>
            <option value="">✍️ 自定义：清空并手动输入链接...</option>
        </select>
        <input type="text" id="extUrl" placeholder="请选择上方接口或粘贴你的链接..." value="https://cf.090227.xyz/ct?ips=100" autocomplete="off">
    </div>

    <div class="form-group">
        <label>
            安全 Token (必填!)
            <a href="https://t.me/+UqUGreTFpjJzfHwN" target="_blank" style="font-size: 12px; color: #58a6ff; font-weight: normal; margin-left: 8px; text-decoration: none;">(前往获取)</a>
        </label>
        <input type="password" id="subToken" placeholder="防止接口被他人滥用生成订阅, 请输入" autocomplete="off">
    </div>

    <button onclick="generateSub()" id="genBtn" style="margin-top:10px;">生成优选短链</button>
    
    <div class="form-group" style="margin-top: 20px;">
        <label>您的专属订阅 ❗</label>
        <input type="text" id="subResult" placeholder="点击生成后自动出现" readonly onclick="copyLink()">
    </div>
    
    <div id="qrWrap">
        <div id="qrCodeBox"></div>
    </div>

    <div class="footer">
        本项目由: <a href="https://github.com/DesireOr2/Desire-Sub-Worker" target="_blank" class="tg-link">Desire-Sub-Worker</a>提供技术支持 - 由 <a href="https://github.com/zhuqq2020/Desire-Sub-Worker" target="_blank" class="tg-link">SPGCC</a> 提供维护 &copy; 2099
    </div>
</div>
<script>
function toggleExtInput() {
    const val = document.getElementById('ipSource').value;
    document.getElementById('extUrlGroup').style.display = val === 'ext' ? 'block' : 'none';
}

async function generateSub() {
    const link = document.getElementById('nodeLink').value.trim();
    const token = document.getElementById('subToken').value.trim();
    const source = document.getElementById('ipSource').value;
    const extUrl = document.getElementById('extUrl').value.trim();

    if (!link) { alert('哎呀，你还没有填入节点链接哦！'); return; }
    if (source === 'ext' && !extUrl) { alert('请填写外部优选链接！'); return; }

    const btn = document.getElementById('genBtn');
    btn.innerText = "生成中..."; btn.style.opacity = "0.7";
    btn.disabled = true;
    
    let subParams = '/sub?base=' + encodeURIComponent(link);
    if(token) subParams += '&token=' + encodeURIComponent(token);
    if(source === 'ext') subParams += '&source=ext&ext_url=' + encodeURIComponent(extUrl);
    
    try {
        const res = await fetch('/api/shorten', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ longUrl: subParams })
        });
        const data = await res.json();

        if (data.success) {
            const shortUrl = window.location.origin + '/s/' + data.shortId;
            document.getElementById('subResult').value = shortUrl;
            
            const qrWrap = document.getElementById('qrWrap');
            const qrCodeBox = document.getElementById('qrCodeBox');
            qrCodeBox.innerHTML = ''; 
            qrWrap.style.display = 'flex'; 
            
            new QRCode(qrCodeBox, {
                text: shortUrl, width: 180, height: 180,
                colorDark : "#000000", colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.M
            });
        } else {
            alert('生成短链失败: ' + (data.error || '未知错误'));
            document.getElementById('subResult').value = window.location.origin + subParams;
        }
    } catch (e) {
        alert('网络请求失败，请检查控制台。');
        document.getElementById('subResult').value = window.location.origin + subParams;
    } finally {
        btn.innerText = "生成优选短链"; 
        btn.style.opacity = "1";
        btn.disabled = false;
    }
}

function copyLink() {
    const res = document.getElementById('subResult');
    if(res.value) { res.select(); document.execCommand('copy'); alert('✅ 订阅链接已复制！快去客户端添加吧。'); }
}
</script>
</body>
</html>`;

const getAdminHTML = () => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>优选 IP 管理后台</title>
<style>
:root{--bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--fg:#e6edf3;--fg2:#b3bac4;--fg3:#8b949e;--border:#30363d;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--purple:#a371f7;--orange:#db6d28;--radius:12px;}
*{margin:0;padding:0;box-sizing:border-box}
body{font:15px/1.6 sans-serif;background:var(--bg);color:var(--fg);min-height:100vh}
.container{max-width:1200px;margin:0 auto;padding:30px 24px}
.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:40px}
h1{font-size:32px;background:linear-gradient(135deg,var(--blue),var(--purple));-webkit-background-clip:text;color:transparent; margin:0;}
.back-btn { color: var(--blue); text-decoration: none; font-weight: bold; }
.section{background:var(--bg2);border-radius:var(--radius);padding:24px;margin-bottom:24px;border:1px solid var(--border)}
h2{font-size:18px;margin-bottom:20px;display:flex;align-items:center;gap:10px}
h2::before{content:'';width:4px;height:16px;background:var(--blue);border-radius:2px}
.stats{display:flex;gap:16px;margin-bottom:24px}
.stat{flex:1;background:var(--bg3);padding:20px;border-radius:var(--radius);text-align:center;border:1px solid var(--border)}
.stat-num{font-size:28px;font-weight:bold;color:var(--blue)}
input,textarea{width:100%;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--fg);margin-bottom:16px}
input:focus,textarea:focus{outline:none;border-color:var(--blue);}
button{background:var(--blue);color:#fff;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-weight:bold;margin-right:8px;margin-bottom:8px;transition: opacity 0.2s;}
button:hover{opacity: 0.8;}
button:disabled{opacity: 0.5; cursor: not-allowed;}
button.danger{background:var(--red)}
button.sec{background:var(--bg3);color:var(--fg)}
button.page-btn{padding:8px 14px; margin:0;}
button.page-btn.active{background:var(--blue); color:#fff; cursor:default; opacity:1;}
.ip-list{list-style:none;}
.ip-item{display:flex;justify-content:space-between;align-items:center;padding:16px;background:var(--bg3);border:1px solid var(--border);margin-bottom:8px;border-radius:8px; flex-wrap: wrap; gap: 10px;}
.ip-address { font-family:monospace; font-size:16px; color:var(--fg); word-break: break-all; } 
.ip-meta{font-size:13px;color:var(--fg2);margin-top:4px}
.tag{background:rgba(88,166,255,0.1);color:var(--blue);padding:2px 8px;border-radius:4px;font-size:12px;margin-right:6px}
.action-buttons{display: flex; gap: 8px; flex-wrap: wrap; align-items: center;}
.status-text.active { color: var(--green); }
.status-text.inactive { color: var(--red); }
.search-box { display:flex; gap:8px; margin-bottom:20px; flex-wrap:wrap; }
.search-box input { margin-bottom:0; flex:1; min-width:200px; }
.page-badge { color:var(--fg2); font-size:14px; background:var(--bg3); padding:6px 14px; border-radius:20px; border:1px solid var(--border); }

@media (max-width: 768px) {
    .container { padding: 15px 12px; }
    .header { flex-direction: column; align-items: flex-start; gap: 10px; margin-bottom: 20px; }
    .ip-item { flex-direction: column; align-items: flex-start; }
    .action-buttons button, .search-box button { width: 100%; margin-right: 0; }
    .action-buttons { flex-direction: column; width: 100%; }
    #pagination { gap: 4px; }
    .page-btn { padding: 6px 10px; }
}
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>优选 IP 库管理</h1>
        <a href="/" class="back-btn">&larr; 返回首页</a>
    </div>

    <div class="stats">
        <div class="stat"><div class="stat-num" id="total">-</div><div>总优选IP</div></div>
        <div class="stat"><div class="stat-num" id="active">-</div><div>活跃中</div></div>
    </div>

    <div class="section">
        <h2>批量添加 / 删除指定 IP</h2>
        <textarea id="batchIps" rows="5" placeholder="格式: IP:端口#国家 (例如 104.16.2.3:443#美国)&#10;每行一个。删除指定IP时只需粘贴要删的IP或完整节点链接即可。"></textarea>
        <div class="action-buttons">
            <button onclick="batchImport()">批量导入</button>
            <button class="danger" onclick="batchDelete()">删除指定IP</button>
            <button class="danger" style="background:#8b0000;" onclick="clearAll()">清空全部数据</button>
        </div>
    </div>

    <div class="section">
        <h2>操作面板与搜索</h2>
        <div class="search-box">
            <input id="searchInput" placeholder="无需回车，输入内容自动搜索...">
            <button class="sec" style="margin-bottom:0;" onclick="clearSearch()">显示全部</button>
        </div>
        <div class="action-buttons" style="flex-direction:row;">
            <button class="sec" onclick="sortIps()">按地区排序</button>
            <button class="sec" onclick="removeDuplicates()">清理重复IP</button>
            <button class="sec" style="color:var(--green)" onclick="toggleAll(1)">全部启用</button>
            <button class="sec" style="color:var(--red)" onclick="toggleAll(0)">全部禁用</button>
        </div>
        <div id="msg" style="color:var(--green);margin-top:10px;font-weight:bold"></div>
    </div>

    <div class="section">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
            <h2 style="margin:0;">IP 列表</h2>
            <div class="page-badge">第 <strong id="page" style="color:var(--blue)">1</strong> 页 / 共 <strong id="totalPages" style="color:var(--blue)">1</strong> 页</div>
        </div>
        <div class="ip-list" id="list">加载中...</div>
        <div id="pagination" style="margin-top:24px; display:flex; justify-content:center; gap:8px; flex-wrap:wrap; align-items:center;"></div>
    </div>
</div>

<div id="editModal" style="display:none; position:fixed; inset:0; background:rgba(13,17,23,0.8); align-items:center; justify-content:center; z-index:1000; padding:20px; backdrop-filter:blur(4px);">
    <div style="background:var(--bg2); border-radius:var(--radius); padding:24px; width:100%; max-width:400px; border:1px solid var(--border); box-shadow: 0 4px 24px rgba(0,0,0,0.5);">
        <h2 style="margin-top:0; color:var(--fg); font-size:20px;">编辑节点信息</h2>
        <input id="editId" type="hidden">
        
        <label style="display:block; font-size:13px; color:var(--fg2); margin-bottom:6px;">IP 和 端口</label>
        <input id="editIp" placeholder="例如 104.16.2.3:443" style="margin-bottom:16px;">
        
        <label style="display:block; font-size:13px; color:var(--fg2); margin-bottom:6px;">备注名称</label>
        <input id="editName" placeholder="例如 香港优选 (选填)" style="margin-bottom:16px;">
        
        <label style="display:block; font-size:13px; color:var(--fg2); margin-bottom:6px;">排序权重 (越小越靠前，置顶可填 0 或 -1)</label>
        <input id="editPriority" type="number" placeholder="数字越小越靠前" style="margin-bottom:8px;">

        <div style="display:flex; gap:10px; margin-top:20px;">
            <button style="flex:1;" onclick="saveEdit()">保存修改</button>
            <button style="flex:1;" class="sec" onclick="closeEdit()">取消</button>
        </div>
    </div>
</div>

<script>
let page = 1;
let totalPages = 1;
let currentKeyword = '';
let searchTimeout = null;

const $ = id => document.getElementById(id);
const msg = t => { $('msg').innerText = t; setTimeout(() => $('msg').innerText='', 3000) };
const api = async (p, o={}) => { const r = await fetch('/api'+p, {headers:{'Content-Type':'application/json'}, ...o}); return r.json(); };

$('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { currentKeyword = e.target.value.trim(); page = 1; load(); }, 500); 
});

const clearSearch = () => { $('searchInput').value = ''; currentKeyword = ''; page = 1; load(); };

const load = async () => {
    const query = new URLSearchParams({ page, needTotal: 'true' });
    if (currentKeyword) query.append('keyword', currentKeyword);

    const [stats, res] = await Promise.all([api('/ips/stats'), api('/ips?' + query.toString())]);
    
    $('total').innerText = stats.total; $('active').innerText = stats.active;
    totalPages = res.pagination.pages || 1;
    $('page').innerText = page; $('totalPages').innerText = totalPages;

    $('list').innerHTML = res.ips.map(ip => \`
        <li class="ip-item">
            <div>
                <div class="ip-address">\${ip.displayIp}:\${ip.port}</div>
                <div class="ip-meta">
                    \${ip.name ? '<span class="tag">'+ip.name+'</span>' : ''}
                    状态: <span class="status-text \${ip.active ? 'active' : 'inactive'}">\${ip.active?'启用中':'已禁用'}</span>
                </div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; width:100%; justify-content: flex-end;">
                <button class="sec" onclick="openEdit(\${ip.id}, '\${ip.displayIp}', '\${ip.port}', '\${ip.name || ''}', \${ip.priority || 0})">编辑</button>
                <button class="sec" onclick="toggleIp(\${ip.id}, \${ip.active})">\${ip.active?'禁用':'启用'}</button>
                <button class="danger" onclick="del(\${ip.id})">删除</button>
            </div>
        </li>
    \`).join('') || '<div style="text-align:center; color:var(--fg2); padding:30px;">'+(currentKeyword?'没有搜索到匹配的节点':'暂无数据')+'</div>';
    
    renderPagination();
};

const renderPagination = () => {
    let html = \`<button class="sec page-btn" \${page === 1 ? 'disabled' : \`onclick="goToPage(\${page-1})"\`}>上一页</button>\`;
    let start = Math.max(1, page - 2);
    let end = Math.min(totalPages, page + 2);
    if (start > 1) {
        html += \`<button class="sec page-btn" onclick="goToPage(1)">1</button>\`;
        if (start > 2) html += \`<span style="color:var(--fg2); padding:0 4px;">...</span>\`;
    }
    for (let i = start; i <= end; i++) {
        if (i === page) html += \`<button class="page-btn active">\${i}</button>\`;
        else html += \`<button class="sec page-btn" onclick="goToPage(\${i})">\${i}</button>\`;
    }
    if (end < totalPages) {
        if (end < totalPages - 1) html += \`<span style="color:var(--fg2); padding:0 4px;">...</span>\`;
        html += \`<button class="sec page-btn" onclick="goToPage(\${totalPages})">\${totalPages}</button>\`;
    }
    html += \`<button class="sec page-btn" \${page === totalPages ? 'disabled' : \`onclick="goToPage(\${page+1})"\`}>下一页</button>\`;
    $('pagination').innerHTML = html;
};

const goToPage = (p) => { page = p; load(); };
const poll = (id, cb) => {
    const t = setInterval(async () => {
        const res = await api('/task/'+id);
        if(res.status === 'completed' || res.status === 'failed') {
            clearInterval(t); msg(res.message); cb();
        }
    }, 1000);
};

const toggleIp = async (id, currentStatus) => { await api('/ips/'+id, {method:'PUT', body:JSON.stringify({active: currentStatus ? 0 : 1})}); load(); };
const openEdit = (id, ip, port, name, priority) => { 
    $('editId').value = id; 
    $('editIp').value = ip + ':' + port; 
    $('editName').value = name; 
    $('editPriority').value = priority;
    $('editModal').style.display = 'flex'; 
};
const closeEdit = () => { $('editModal').style.display = 'none'; };
const saveEdit = async () => {
    const id = $('editId').value;
    const ipStr = $('editIp').value.trim();
    const nameStr = $('editName').value.trim();
    const priorityVal = parseInt($('editPriority').value);

    if(!ipStr) return msg('IP不能为空');
    let fullIP = ipStr; if(nameStr) fullIP += '#' + nameStr;

    const updateBody = { ip: fullIP };
    if (!isNaN(priorityVal)) updateBody.priority = priorityVal; 

    try { 
        await api('/ips/'+id, {method:'PUT', body:JSON.stringify(updateBody)}); 
        msg('修改成功'); 
        closeEdit(); 
        load(); 
    } catch(e) { 
        msg('修改失败，格式错误'); 
    }
};
const del = async (id) => { if(confirm('确定要彻底删除此IP吗？')) { await api('/ips/'+id, {method:'DELETE'}); load(); } };

const toggleAll = async (active) => { if(!confirm(active ? '确定将所有节点设为启用吗？' : '确定将所有节点设为禁用吗？')) return; const res = await api('/ips/toggle-all', {method:'POST', body:JSON.stringify({active})}); msg('操作执行中...'); poll(res.taskId, load); };
const batchImport = async () => { const ips = $('batchIps').value.split('\\n').filter(Boolean); if(!ips.length) { msg('请先在输入框填写 IP'); return; } const res = await api('/ips/batch', {method:'POST', body:JSON.stringify({ips})}); msg('导入任务已启动...'); $('batchIps').value = ''; poll(res.taskId, load); };
const batchDelete = async () => { const ips = $('batchIps').value.split('\\n').filter(Boolean); if(!ips.length) { msg('请先在输入框填写要删除的 IP 或节点链接'); return; } if(!confirm('确定要删除上面填写的节点对应的 IP 吗？')) return; const res = await api('/ips/batch-delete', {method:'POST', body:JSON.stringify({ips})}); msg('批量删除任务已启动...'); $('batchIps').value = ''; poll(res.taskId, load); };
const clearAll = async () => { if(!confirm('警告：确定清空所有优选IP吗？此操作不可逆！')) return; const res = await api('/ips/clear', {method:'DELETE'}); msg('清空任务启动...'); poll(res.taskId, () => { page=1; load(); }); };
const sortIps = async () => { const res = await api('/ips/sort', {method:'POST'}); msg('排序中...'); poll(res.taskId, load); };
const removeDuplicates = async () => { const res = await api('/ips/remove-duplicates', {method:'POST'}); msg('去重中...'); poll(res.taskId, load); };

$('editModal').onclick = (e) => { if(e.target === $('editModal')) closeEdit(); };
load();
</script>
</body>
</html>`;

// ==========================================
// 密码验证核心逻辑
// ==========================================
const checkAuth = (req, env) => {
    const expectedPassword = env.ADMIN_PASSWORD;
    if (!expectedPassword) return true;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return false;

    const [scheme, encoded] = authHeader.split(' ');
    if (scheme !== 'Basic' || !encoded) return false;

    try {
        const decoded = atob(encoded);
        const [username, password] = decoded.split(':');
        if (password === expectedPassword) return true;
    } catch (e) {
        return false;
    }
    return false;
};

// ==========================================
// 主路由引擎
// ==========================================
export default {
    async fetch(req, env, ctx) {
        const url = new URL(req.url);
        const path = url.pathname;

        // 处理短链跳转
        if (path.startsWith('/s/')) {
            const shortId = path.slice(3);
            if (env.TASK_KV) {
                const longUrl = await env.TASK_KV.get(`short:${shortId}`);
                if (longUrl) {
                    return Response.redirect(new URL(longUrl, url.origin).toString(), 302);
                }
            }
            return new Response('❌ 短链接无效或已过期', { status: 404, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
        }

        // 安全拦截区
        if (path === '/admin' || path.startsWith('/api/')) {
            if (path !== '/api/shorten' && !checkAuth(req, env)) {
                return new Response('Unauthorized', {
                    status: 401,
                    headers: { 'WWW-Authenticate': 'Basic realm="Admin Access Requires Password"' }
                });
            }
        }

        if (path === '/') {
            return new Response(getPublicHTML(), {
                headers: { 'Content-Type': 'text/html;charset=utf-8' }
            });
        }

        if (path === '/admin') {
            return new Response(getAdminHTML(), {
                headers: { 'Content-Type': 'text/html;charset=utf-8' }
            });
        }

        // /sub 接口：自适应订阅
        if (path === '/sub') {
            const baseLink = url.searchParams.get('base');
            const reqToken = url.searchParams.get('token');
            const source = url.searchParams.get('source'); 
            const extUrl = url.searchParams.get('ext_url');

            // Token 校验
            const expectedToken = env.SUB_TOKEN;
            if (expectedToken && reqToken !== expectedToken) {
                const userAgent = req.headers.get('User-Agent') || '';
                const clientType = detectClientType(userAgent);
                
                if (clientType === 'clash') {
                    return new Response(createErrorClashConfig('Token 验证失败，请检查链接参数'), {
                        headers: { 
                            'Content-Type': 'text/yaml;charset=utf-8',
                            'Content-Disposition': `attachment; filename="error_subscription"`,
                            'Cache-Control': 'no-cache'
                        }
                    });
                } else {
                    const errorMsg = encodeBase64(createErrorNode('❌ Token 验证失败，请检查链接参数'));
                    return new Response(errorMsg, { 
                        headers: { 
                            'Content-Type': 'text/plain;charset=utf-8', 
                            'Cache-Control': 'no-cache',
                            'Content-Disposition': 'attachment; filename="error_subscription.txt"'
                        } 
                    });
                }
            }

            if (!baseLink) {
                const userAgent = req.headers.get('User-Agent') || '';
                const clientType = detectClientType(userAgent);
                
                if (clientType === 'clash') {
                    return new Response(createErrorClashConfig('请在首页输入基础节点链接'), {
                        headers: { 
                            'Content-Type': 'text/yaml;charset=utf-8',
                            'Content-Disposition': `attachment; filename="error_subscription"`,
                            'Cache-Control': 'no-cache'
                        }
                    });
                } else {
                    const errorMsg = encodeBase64(createErrorNode('❌ 请在首页输入基础节点链接'));
                    return new Response(errorMsg, {
                        headers: { 
                            'Content-Type': 'text/plain;charset=utf-8', 
                            'Cache-Control': 'no-cache',
                            'Content-Disposition': 'attachment; filename="error_subscription.txt"'
                        }
                    });
                }
            }

            // 检测客户端类型
            const userAgent = req.headers.get('User-Agent') || '';
            const clientType = detectClientType(userAgent);
            
            // 从基础节点链接中提取真实的 host 地址
            const host = extractHostFromBaseLink(baseLink);
            // 生成纯英文的订阅名称（避免乱码）
            const subscriptionNameEn = `${host}_CF_Subscription`;
            const subscriptionNameZh = `${host}_CF优选订阅`;
            
            // 获取用户流量信息
            const userInfo = await getUserTrafficInfo(env.TASK_KV, reqToken);
            
            // 对于 Clash 客户端，直接返回 subconverter 转换后的结果
            if (clientType === 'clash') {
                const currentUrl = new URL(req.url);
                const serviceBaseUrl = `${currentUrl.protocol}//${currentUrl.host}`;
                const subscriptionUrl = buildSubscriptionUrl(serviceBaseUrl + '/raw_sub', baseLink, source, extUrl, reqToken);
                
                const clashApiUrl = env.CLASH_API_URL || CLASH_API_URL;
                const clashRuleUrl = env.CLASH_RULE_URL || CLASH_RULE_URL;
                
                const clashConfig = await convertToClashConfig(subscriptionUrl, clashApiUrl, clashRuleUrl, userInfo, host);
                
                const headers = {
                    'Content-Type': 'text/yaml;charset=utf-8',
                    'Content-Disposition': encodeContentDisposition(subscriptionNameZh),
                    'Cache-Control': `public, max-age=${CACHE_TTL}`,
                    'Profile-Updated': new Date().toUTCString()
                };
                
                const userInfoHeader = generateSubscriptionUserInfo(userInfo);
                if (userInfoHeader) {
                    headers['Subscription-UserInfo'] = userInfoHeader;
                }
                
                return new Response(clashConfig, { headers });
            }
            
            // 对于 Hiddify 和其他客户端，使用英文名称避免乱码
            const cache = caches.default;
            const cacheKey = new Request(url.toString(), req); 
            let res = await cache.match(cacheKey);
            if (res) return res;

            let ipRows = [];

            if (source === 'ext' && extUrl) {
                try {
                    const extRes = await fetch(extUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }});
                    if (!extRes.ok) throw new Error(`HTTP状态码异常: ${extRes.status}`);
                    
                    const extText = await extRes.text();
                    
                    if (extText.trim().startsWith('<')) {
                        throw new Error('获取到的是网页而非纯文本列表，可能是链接失效或触发了防CC拦截');
                    }

                    const lines = extText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                    ipRows = lines.map(line => {
                        const { displayIp, port, name } = parseIP(line);
                        return { 
                            ip: port === 'N/A' ? displayIp : `${displayIp}:${port}`, 
                            name: name || '外网优选节点' 
                        };
                    }).filter(r => r.ip);
                } catch (e) {
                    const errorMsg = encodeBase64(createErrorNode(`❌ 外部优选库拉取失败: ${e.message}`));
                    return new Response(errorMsg, {
                        headers: { 
                            'Content-Type': 'text/plain;charset=utf-8', 
                            'Cache-Control': 'no-cache',
                            'Content-Disposition': encodeContentDisposition(subscriptionNameZh)
                        }
                    });
                }
            } else {
                const { results } = await env.DB.prepare(
                    'SELECT ip, name FROM ips WHERE active=1 ORDER BY priority, id LIMIT ?'
                ).bind(MAX_IPS).all();
                ipRows = results;
            }

            const generatedLinks = ipRows
                .map(row => multiplexLink(baseLink, row))
                .filter(Boolean)
                .join('\n');

            const finalNodes = generatedLinks || createErrorNode('❌ 没有生成任何可用节点(可能是基础节点格式不兼容或无优选IP)');
            
            // 构建订阅内容
            let subscriptionContent = finalNodes;
            const trafficComment = generateSubscriptionUserInfo(userInfo);
            if (trafficComment) {
                subscriptionContent = `# ${trafficComment}\n${finalNodes}`;
            }
            
            const nodesBase64 = encodeBase64(subscriptionContent);

            // 使用英文名称避免 Hiddify 显示乱码，同时保留中文名称在 Content-Disposition 中
            const headers = {
                'Content-Type': 'text/plain;charset=utf-8',
                'Content-Disposition': encodeContentDisposition(subscriptionNameZh),
                'Cache-Control': `public, max-age=${CACHE_TTL}`,
                'Subscription-UserInfo': generateSubscriptionUserInfo(userInfo) || '',
                'Profile-Updated': new Date().toUTCString(),
                'profile-title': subscriptionNameEn,
                'profile-update-interval': '24',
                'profile-web-page-url': url.origin
            };

            res = new Response(nodesBase64, { headers });

            ctx.waitUntil(cache.put(cacheKey, res.clone()));
            return res;
        }
        
        // 原始订阅接口（用于 subconverter 转换）
        if (path === '/raw_sub') {
            const baseLink = url.searchParams.get('base');
            const reqToken = url.searchParams.get('token');
            const source = url.searchParams.get('source'); 
            const extUrl = url.searchParams.get('ext_url');

            const expectedToken = env.SUB_TOKEN;
            if (expectedToken && reqToken !== expectedToken) {
                return new Response(encodeBase64(createErrorNode('Token 验证失败')), {
                    headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-cache' }
                });
            }

            if (!baseLink) {
                return new Response(encodeBase64(createErrorNode('缺少基础节点链接')), {
                    headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-cache' }
                });
            }

            let ipRows = [];

            if (source === 'ext' && extUrl) {
                try {
                    const extRes = await fetch(extUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }});
                    if (!extRes.ok) throw new Error(`HTTP状态码异常: ${extRes.status}`);
                    
                    const extText = await extRes.text();
                    
                    if (extText.trim().startsWith('<')) {
                        throw new Error('获取到的是网页而非纯文本列表');
                    }

                    const lines = extText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                    ipRows = lines.map(line => {
                        const { displayIp, port, name } = parseIP(line);
                        return { 
                            ip: port === 'N/A' ? displayIp : `${displayIp}:${port}`, 
                            name: name || '外网优选节点' 
                        };
                    }).filter(r => r.ip);
                } catch (e) {
                    return new Response(encodeBase64(createErrorNode(`外部优选库拉取失败: ${e.message}`)), {
                        headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-cache' }
                    });
                }
            } else {
                const { results } = await env.DB.prepare(
                    'SELECT ip, name FROM ips WHERE active=1 ORDER BY priority, id LIMIT ?'
                ).bind(MAX_IPS).all();
                ipRows = results;
            }

            const generatedLinks = ipRows
                .map(row => multiplexLink(baseLink, row))
                .filter(Boolean)
                .join('\n');

            const finalNodes = generatedLinks || createErrorNode('没有生成任何可用节点');
            const nodesBase64 = encodeBase64(finalNodes);

            return new Response(nodesBase64, {
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8',
                    'Cache-Control': `public, max-age=${CACHE_TTL}`
                }
            });
        }

        if (path.startsWith('/api/')) {
            return handleApiRoute(req, env.DB, ctx, env.TASK_KV);
        }

        return new Response('Not Found', { status: 404 });
    },
};
