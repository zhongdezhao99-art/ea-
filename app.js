const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const isAdminEntry = window.EA_DEMO_ADMIN === true;
const tokenKey = isAdminEntry ? 'ea_demo_admin_token' : 'ea_demo_token';
const sidebarKey = 'ea_demo_sidebar_collapsed';

const state = {
  token: localStorage.getItem(tokenKey) || '',
  user: null,
  section: 'market',
  adminSection: 'overview',
  authMode: 'login',
  query: '',
  searchDraft: '',
  forumQuery: '',
  forumSearchDraft: '',
  type: '全部',
  sort: 'total',
  accountPanel: 'overview',
  uploadForm: { title: '', type: '外汇EA', platform: '', price: '', billingMode: 'one_time', sellerContact: '', desc: '' },
  editingStrategyId: null,
  uploadPreview: {},
  uploadUrls: {},
  programFile: null,
  codeCooldown: { registerUntil: 0, bindUntil: 0, resetUntil: 0 },
  detailId: null,
  forumDetailId: null,
  forumSection: 'all',
  sidebarCollapsed: localStorage.getItem(sidebarKey) === '1',
  modal: null,
  postComposer: false,
};

let strategies = [];
let comments = {};
let forumPosts = [];
let ledger = [];
let adminData = { users: [], orders: [], blockedWords: [], technicalAccounts: [], metrics: {} };
let emailCodeCooldownTimer = null;

const tradeTypeLabels = { forex_ea: '外汇EA', futures: '期货', crypto: '虚拟货币', stock: '股票', index: '指数', cfd: 'CFD', other: '其他' };
const tradeTypeCodes = Object.fromEntries(Object.entries(tradeTypeLabels).map(([k, v]) => [v, k]));
const riskLabels = { low: '低风险', medium: '中风险', medium_high: '中高风险', high: '高风险' };
const statusLabels = { draft: '草稿', pending_review: '待审核', listed: '已上架', unlisted: '已下架', rejected: '已拒绝' };
const ledgerLabels = { recharge: '充值', purchase: '购买策略', sale_income: '销售收入', platform_fee: '平台手续费', refund: '退款', adjustment: '后台调整' };
const billingModeLabels = { one_time: '一次性收费', subscription: '订阅制' };
const types = ['全部', '外汇EA', '期货', '虚拟货币', '股票', '指数', 'CFD', '其他'];
const forumSections = [
  { id: 'all', label: '全部交流区' },
  { id: 'general', label: '综合交流区' },
  { id: 'forex_ea', label: '外汇EA区' },
  { id: 'futures', label: '期货策略区' },
  { id: 'crypto', label: '虚拟货币区' },
  { id: 'stock_index', label: '股票指数区' },
  { id: 'deployment', label: '部署帮助区' },
];

const money = (v) => `¥${Number(v || 0).toLocaleString('zh-CN')}`;
const billingLabel = (mode) => billingModeLabels[mode] || billingModeLabels.one_time;
const billingPriceText = (s) => `${money(s.price)}${s.billingMode === 'subscription' ? ' / 期' : ''}`;
const forumSectionLabel = (id) => forumSections.find((x) => x.id === id)?.label || '综合交流区';
const isAdmin = () => state.user?.role === 'admin';
const isForumContext = () => state.section === 'forum' || state.section === 'forumDetail';
const esc = (v) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const toastMsg = (m) => { toast.textContent = m; toast.classList.add('show'); clearTimeout(toastMsg.t); toastMsg.t = setTimeout(() => toast.classList.remove('show'), 2600); };
const emailCodeCooldownSeconds = 60;
const forumAvatar = (name, url) => `<div class="forum-avatar">${url ? `<img src="${esc(url)}" alt="${esc(name || '用户')}头像">` : esc((name || 'U').slice(0, 1).toUpperCase())}</div>`;

function applySearch() {
  state.query = state.searchDraft;
  state.section = 'market';
  render();
}

function applyForumSearch() {
  state.forumQuery = state.forumSearchDraft;
  state.section = 'forum';
  render();
}

function resetMarket() {
  state.query = '';
  state.searchDraft = '';
  state.type = '全部';
  state.sort = 'total';
  state.section = 'market';
  render();
}

function codeCooldownLeft(kind) {
  return Math.max(0, Math.ceil(((state.codeCooldown?.[`${kind}Until`] || 0) - Date.now()) / 1000));
}

function codeButtonLabel(kind) {
  const left = codeCooldownLeft(kind);
  return left > 0 ? `${left} 秒后重发` : '发送验证码';
}

function updateEmailCodeButtons() {
  let hasActiveCooldown = false;
  [['register', '[data-send-register-code]'], ['bind', '[data-send-bind-code]'], ['reset', '[data-send-reset-code]']].forEach(([kind, selector]) => {
    const button = document.querySelector(selector);
    if (!button) return;
    const left = codeCooldownLeft(kind);
    hasActiveCooldown ||= left > 0;
    button.disabled = left > 0;
    button.textContent = codeButtonLabel(kind);
  });
  if (!hasActiveCooldown && emailCodeCooldownTimer) {
    clearInterval(emailCodeCooldownTimer);
    emailCodeCooldownTimer = null;
  }
}

function startEmailCodeCooldown(kind, seconds = emailCodeCooldownSeconds) {
  state.codeCooldown[`${kind}Until`] = Date.now() + seconds * 1000;
  updateEmailCodeButtons();
  emailCodeCooldownTimer ||= setInterval(updateEmailCodeButtons, 1000);
}

function syncCooldownFromError(kind, message) {
  const match = String(message || '').match(/等待\s*(\d+)\s*秒/);
  if (match) startEmailCodeCooldown(kind, Number(match[1]));
}

function chart(title) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420"><rect width="720" height="420" fill="#101827"/><rect x="28" y="28" width="664" height="364" rx="18" fill="#111827" stroke="#334155"/><text x="48" y="74" fill="#f8fafc" font-family="Microsoft YaHei,Arial" font-size="28" font-weight="700">${esc(title)}</text><polyline points="48,260 116,226 184,238 252,178 320,190 388,124 456,148 524,96" fill="none" stroke="#f59e0b" stroke-width="8" stroke-linecap="round"/><text x="48" y="326" fill="#14b8a6" font-family="Arial" font-size="36" font-weight="800">+28.6%</text><text x="48" y="354" fill="#94a3b8" font-family="Microsoft YaHei,Arial" font-size="18">performance image</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || '请求失败');
  return data;
}

function applyData(data) {
  if (data.user) state.user = { ...data.user, displayName: data.user.displayName || data.user.username, balance: Number(data.user.balance || 0) };
  if (Array.isArray(data.strategies)) strategies = data.strategies.map((s) => ({ ...s, id: String(s.id), billingMode: s.billingMode || 'one_time', sellerContact: s.sellerContact || '', type: tradeTypeLabels[s.type] || s.type, risk: riskLabels[s.risk] || s.risk, status: statusLabels[s.status] || s.status, image: s.image || chart(s.platform || 'Backtest'), backtestImage: s.backtestImage || chart('Backtest'), dataImage: s.dataImage || chart('Data Chart') }));
  comments = data.comments || comments;
  if (Array.isArray(data.forumPosts)) forumPosts = data.forumPosts;
  if (Array.isArray(data.ledger)) ledger = data.ledger.map((x) => ({ ...x, type: ledgerLabels[x.type] || x.type, status: x.status === 'done' ? '已完成' : x.status }));
  if (data.admin) adminData = data.admin;
}
async function refresh() { applyData(await api('/api/bootstrap')); }

function saveUploadForm() {
  const title = document.querySelector('#strategy-title');
  if (!title) return;
  state.uploadForm = {
    title: title.value,
    type: document.querySelector('#strategy-type')?.value || state.uploadForm.type || '外汇EA',
    platform: document.querySelector('#strategy-platform')?.value || '',
    price: document.querySelector('#strategy-price')?.value || '',
    billingMode: document.querySelector('#strategy-billing')?.value || state.uploadForm.billingMode || 'one_time',
    sellerContact: document.querySelector('#seller-contact')?.value || '',
    desc: document.querySelector('#strategy-desc')?.value || '',
  };
}

function resetUploadForm() {
  state.uploadForm = { title: '', type: '外汇EA', platform: '', price: '', billingMode: 'one_time', sellerContact: '', desc: '' };
}

function render() {
  document.body.classList.toggle('market-searching', Boolean(state.user && !isAdmin() && state.section === 'market' && state.query.trim()));
  if (!state.user) app.innerHTML = isAdminEntry ? adminLogin() : loginPage();
  else app.innerHTML = isAdmin() ? adminApp() : userApp();
  bind();
}

function loginPage() {
  const reg = state.authMode === 'register';
  const reset = state.authMode === 'reset';
  const content = reset ? resetPasswordForm() : reg ? registerForm() : userLoginForm();
  return `<main class="login-screen"><section class="login-visual"><div><div class="brand-mark">EA</div><h1>多类型交易策略交流社区</h1><p>上传交易策略、设置价格、上传图表和程序文件，购买后开放下载与部署帮助。</p></div><div class="market-strip"><div class="market-tile"><strong>EA</strong><span>MT4 / MT5</span></div><div class="market-tile"><strong>期货</strong><span>CTP</span></div><div class="market-tile"><strong>虚拟货币</strong><span>API</span></div></div></section><section class="login-panel"><div class="auth-tabs"><button class="btn ${!reg && !reset ? 'primary' : ''}" data-auth="login">用户登录</button><button class="btn ${reg ? 'primary' : ''}" data-auth="register">注册账户</button></div>${content}</section></main>`;
}
function userLoginForm() { return `<h2>用户登录</h2><form id="login-form" class="form-grid"><div class="field"><label>邮箱</label><input id="login-email" type="email" autocomplete="email" placeholder="请输入绑定邮箱"></div><div class="field"><label>密码</label><input id="password" type="password" autocomplete="current-password" placeholder="请输入密码"></div><p id="login-error" class="error-text"></p><button class="btn primary full">登录</button><button class="link-button" type="button" data-auth="reset">忘记密码</button></form>`; }
function registerForm() { return `<h2>注册用户账户</h2><form id="register-form" class="form-grid"><div class="field"><label>邮箱账号</label><div class="inline-control"><input id="reg-email" type="email" autocomplete="email" placeholder="用于登录和找回账户"><button class="btn" type="button" data-send-register-code ${codeCooldownLeft('register')>0?'disabled':''}>${codeButtonLabel('register')}</button></div></div><div class="field"><label>邮箱验证码</label><input id="reg-email-code" inputmode="numeric" maxlength="6" placeholder="请输入 6 位验证码"></div><div class="field"><label>用户名</label><input id="reg-name" placeholder="社区显示名称，可之后修改"></div><div class="field"><label>密码</label><input id="reg-password" type="password" placeholder="至少 6 位"></div><div class="field"><label>确认密码</label><input id="reg-password-confirm" type="password" placeholder="请再次输入密码"></div><p id="register-error" class="error-text"></p><button class="btn primary full">注册并进入平台</button></form>`; }
function resetPasswordForm() { return `<h2>忘记密码</h2><form id="reset-form" class="form-grid"><div class="field"><label>邮箱账号</label><div class="inline-control"><input id="reset-email" type="email" autocomplete="email" placeholder="请输入注册邮箱"><button class="btn" type="button" data-send-reset-code ${codeCooldownLeft('reset')>0?'disabled':''}>${codeButtonLabel('reset')}</button></div></div><div class="field"><label>邮箱验证码</label><input id="reset-code" inputmode="numeric" maxlength="6" placeholder="请输入 6 位验证码"></div><div class="field"><label>新密码</label><input id="reset-password" type="password" autocomplete="new-password" placeholder="至少 6 位"></div><div class="field"><label>确认新密码</label><input id="reset-password-confirm" type="password" autocomplete="new-password" placeholder="请再次输入新密码"></div><p id="reset-error" class="error-text"></p><button class="btn primary full">修改密码</button><button class="link-button" type="button" data-auth="login">返回登录</button></form>`; }
function adminLogin() { return `<main class="login-screen admin-login-screen"><section class="login-visual"><div><div class="brand-mark">AD</div><h1>管理员控制台入口</h1><p>管理员入口独立于用户登录页。</p></div></section><section class="login-panel"><h2>管理员登录</h2><form id="admin-login-form" class="form-grid"><div class="field"><label>管理员账号</label><input id="admin-username" autocomplete="username"></div><div class="field"><label>密码</label><input id="admin-password" type="password" autocomplete="current-password"></div><p id="admin-login-error" class="error-text"></p><button class="btn primary full">进入后台</button></form><a class="admin-entry-link" href="index.html">返回用户入口</a></section></main>`; }
function userApp() {
  const pages = { forum: forumPage, forumDetail: forumDetailPage, market: marketPage, detail: detailPage, account: accountPage, upload: uploadPage, editStrategy: editStrategyPage, help: helpPage };
  const sidebarTip = state.sidebarCollapsed ? '展开导航栏' : '折叠导航栏';
  const accountInitial = esc((state.user.displayName || state.user.username || 'U').slice(0, 1).toUpperCase());
  return `<div class="app-layout ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}"><aside class="sidebar"><button class="sidebar-toggle" type="button" data-sidebar-toggle data-tooltip="${sidebarTip}" aria-label="${sidebarTip}"><span></span><span></span><span></span></button><div class="sidebar-content"><div class="brand-row"><div class="brand-mark">EA</div><div class="brand-copy"><strong>Strategy Hub</strong><span>交易策略社区</span></div></div><nav class="nav">${nav('forum','社区论坛')}${nav('market','策略市场')}${nav('help','部署帮助')}</nav><div class="user-panel"><button class="user-chip account-entry ${state.section==='account'?'active':''}" data-section="account" data-tooltip="账户中心" data-initial="${accountInitial}"><strong>${esc(state.user.displayName)}</strong><span>账户中心 · 余额 ${money(state.user.balance)}</span></button><button class="btn ghost logout-button" data-logout data-tooltip="退出登录">退出登录</button></div></div></aside><section class="workspace"><header class="topbar">${topbarSearch()}${topbarActions()}</header><main class="main">${(pages[state.section] || marketPage)()}</main></section></div>${state.modal ? payModal() : ''}${state.postComposer ? postComposerModal() : ''}`;
}
function topbarSearch(){
  if (isForumContext()) {
    return `<div class="search-row"><input id="forum-search" value="${esc(state.forumSearchDraft)}" placeholder="搜索帖子"><button class="btn primary" type="button" data-forum-search>搜索</button><select id="forum-section-filter">${forumSections.map((item) => `<option value="${item.id}" ${state.forumSection === item.id ? 'selected' : ''}>${item.label}</option>`).join('')}</select></div>`;
  }
  return `<div class="search-row"><input id="search" value="${esc(state.searchDraft)}" placeholder="搜索策略"><button class="btn primary" type="button" data-search>搜索</button><select id="type-filter">${types.map((t) => `<option ${state.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
}
function topbarActions(){
  const mine = strategies.filter((x)=>x.owner===state.user.username && !x.ownerDeletedAt);
  const bought = strategies.filter((x)=>x.purchased);
  return `<div class="topbar-actions">${isForumContext() ? '' : `<button class="btn ${state.section==='upload'?'primary':''}" data-section="upload">上传我的策略</button>`}<div class="hover-action"><button class="btn ${state.section==='account'?'primary':''}" data-section="account">我的账户</button><div class="hover-card account-hover-card" role="tooltip"><div class="hover-card-head"><strong>${esc(state.user.displayName)}</strong><span>邮箱 ${esc(state.user.email || state.user.username)}</span></div><div class="hover-row"><span>账户余额</span><em>${money(state.user.balance)}</em></div><div class="hover-row"><span>已购买策略</span><em>${bought.length}</em></div><div class="hover-row"><span>已上传策略</span><em>${mine.length}</em></div><p class="muted">点击进入账户中心，可查看收支明细、头像、用户名和已购策略文件。</p></div></div></div>`;
}
function nav(id, label) { const active = state.section === id || (id === 'market' && state.section === 'detail') || (id === 'forum' && state.section === 'forumDetail'); const attr = id === 'market' ? 'data-market-home' : `data-section="${id}"`; const short = { forum: '论', market: '策', help: '助' }[id] || label.slice(0, 1); return `<button class="nav-button ${active ? 'active' : ''}" ${attr} data-tooltip="${label}" data-short="${short}"><span class="nav-label">${label}</span></button>`; }
function metric(label, value) { return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`; }
function listed() { return strategies.filter((s) => s.status === '已上架'); }
function filtered() {
  const q = state.query.trim().toLowerCase();
  const sorters = {
    total: (a,b) => (b.totalDownloads || b.volume || 0) - (a.totalDownloads || a.volume || 0),
    month: (a,b) => (b.monthlyDownloads || 0) - (a.monthlyDownloads || 0),
    day: (a,b) => (b.dailyDownloads || 0) - (a.dailyDownloads || 0),
    priceAsc: (a,b) => a.price - b.price,
    priceDesc: (a,b) => b.price - a.price,
  };
  return listed()
    .filter((s) => state.type === '全部' || s.type === state.type)
    .filter((s) => !q || `${s.title} ${s.author} ${s.platform}`.toLowerCase().includes(q))
    .sort(sorters[state.sort] || sorters.total);
}
function marketPage() {
  const items = filtered();
  const hasSearch = Boolean(state.query.trim());
  return `<div class="section-title"><div><h1>策略市场</h1></div>${hasSearch ? '<button class="btn primary" type="button" data-market-home>返回首页</button>' : ''}</div><section><div class="filters"><select id="sort-filter" class="filter-select"><option value="total" ${state.sort==='total'?'selected':''}>总下载量排序</option><option value="month" ${state.sort==='month'?'selected':''}>每月下载量排序</option><option value="day" ${state.sort==='day'?'selected':''}>每日下载量排序</option><option value="priceAsc" ${state.sort==='priceAsc'?'selected':''}>价格升序</option><option value="priceDesc" ${state.sort==='priceDesc'?'selected':''}>价格降序</option></select>${types.map((t)=>`<button class="filter-button ${state.type===t?'active':''}" data-type="${t}">${t}</button>`).join('')}</div><div class="strategy-grid">${items.map(card).join('') || '<div class="empty">暂无已上架策略。</div>'}</div></section>`;
}
function forumPage() {
  return `<div class="section-title"><div><h1>社区论坛</h1></div><button class="btn primary post-button" type="button" data-open-post>发帖</button></div>${forumPanel()}`;
}
function forumPanel() {
  const q = state.forumQuery.trim().toLowerCase();
  const posts = (state.forumSection === 'all' ? forumPosts : forumPosts.filter((post) => (post.category || 'general') === state.forumSection))
    .filter((post) => !q || `${post.title} ${post.body} ${post.author}`.toLowerCase().includes(q));
  const empty = q ? '没有找到匹配的帖子。' : '当前交流区暂无帖子。';
  return `<section class="forum-panel">${forumSectionNav()}<div class="forum-list">${posts.map(forumPost).join('') || `<div class="empty">${empty}</div>`}</div></section>`;
}
function forumSectionNav() {
  return `<div class="forum-section-nav">${forumSections.map((item) => `<button class="filter-button ${state.forumSection === item.id ? 'active' : ''}" type="button" data-forum-section="${item.id}">${item.label}</button>`).join('')}</div>`;
}
function forumPost(post) {
  return `<article class="forum-post" data-forum-detail="${post.id}" role="button" tabindex="0" aria-label="查看帖子 ${esc(post.title)}"><div class="forum-post-row">${forumAvatar(post.author, post.authorAvatarUrl)}<div class="forum-post-content"><div class="forum-author-line"><strong>${esc(post.author)}</strong><span>${esc(forumSectionLabel(post.category))}</span><span>${esc(post.createdAt || '')}</span></div><h4>${esc(post.title)}</h4><p>${esc(post.body)}</p><div class="forum-actions"><span>回复 ${post.replyCount || (post.replies || []).length}</span><span>查看详情</span></div></div></div></article>`;
}
function forumDetailPage() {
  const post = forumPosts.find((x)=>x.id===state.forumDetailId);
  if (!post) return `<div class="section-title"><div><h1>帖子详情</h1><p>帖子不存在或已被隐藏。</p></div><button class="btn" data-section="forum">返回论坛</button></div>`;
  const replies = post.replies || [];
  return `<div class="section-title"><div><h1>帖子详情</h1><p>${esc(forumSectionLabel(post.category))} · ${esc(post.author)} · ${esc(post.createdAt || '')}</p></div><button class="btn" data-section="forum">返回论坛</button></div><article class="panel forum-detail"><div class="forum-post-row">${forumAvatar(post.author, post.authorAvatarUrl)}<div class="forum-post-content"><div class="forum-author-line"><strong>${esc(post.author)}</strong><span>${esc(forumSectionLabel(post.category))}</span><span>${esc(post.createdAt || '')}</span></div><h2>${esc(post.title)}</h2><p class="forum-detail-body">${esc(post.body)}</p></div></div></article><section class="panel forum-detail-replies"><div class="forum-head"><div><h3>回复</h3><p class="muted">${replies.length} 条回复</p></div></div><div class="forum-replies">${replies.map((reply)=>`<div class="forum-reply with-avatar">${forumAvatar(reply.author, reply.authorAvatarUrl)}<div><strong>${esc(reply.author)}</strong><span>${esc(reply.body)}</span></div></div>`).join('') || '<div class="empty">暂无回复。</div>'}</div><form class="forum-reply-form detail-reply-form" data-forum-reply="${post.id}"><input name="body" placeholder="回复这个帖子"><button class="btn primary">回复</button></form></section>`;
}
function card(s) { return `<article class="strategy-card" data-detail="${s.id}" role="button" tabindex="0" aria-label="查看 ${esc(s.title)} 详情"><img class="strategy-image" src="${s.image}" alt="${esc(s.title)}"><div class="strategy-body"><div class="strategy-header"><h3>${esc(s.title)}</h3><span class="price">${billingPriceText(s)}</span></div><p>${esc(s.desc)}</p><div class="badge-row"><span class="badge gold">${s.type}</span><span class="badge">${esc(s.platform)}</span><span class="badge">${billingLabel(s.billingMode)}</span><span class="badge ${s.risk.includes('高')?'red':'green'}">${s.risk}</span></div><div class="strategy-header strategy-meta"><span class="muted">下载 ${s.totalDownloads || s.volume || 0} · 评论 ${s.comments}</span><span class="muted">查看详情</span></div></div></article>`; }

function detailPage(){
  const x = strategies.find((s)=>s.id===state.detailId);
  if(!x) return `<div class="section-title"><div><h1>策略详情</h1><p>未找到该策略，可能已下架。</p></div><button class="btn" data-section="market">返回策略市场</button></div>`;
  const list = comments[x.id] || [];
  return `<div class="section-title"><div><h1>${esc(x.title)}</h1><p>${esc(x.type)} · ${esc(x.platform)} · 作者 ${esc(x.author || x.owner)}</p></div><button class="btn" data-section="market">返回策略市场</button></div><div class="detail-layout strategy-detail-layout"><section class="side-stack detail-document"><article class="strategy-detail-main detail-sheet"><div class="detail-hero"><img src="${x.image}" alt="${esc(x.title)}"><div><div class="badge-row"><span class="badge gold">${x.type}</span><span class="badge">${esc(x.platform)}</span><span class="badge">${billingLabel(x.billingMode)}</span><span class="badge ${x.risk.includes('高')?'red':'green'}">${x.risk}</span>${x.hasFile?'<span class="badge green">含程序文件</span>':''}</div><p>${esc(x.desc)}</p></div></div><dl class="detail-facts"><div><dt>策略价格</dt><dd>${billingPriceText(x)}</dd></div><div><dt>收费方式</dt><dd>${billingLabel(x.billingMode)}</dd></div><div><dt>发布者联系方式</dt><dd>${esc(x.sellerContact || '未填写')}</dd></div><div><dt>总下载量</dt><dd>${x.totalDownloads || x.volume || 0}</dd></div><div><dt>本月下载</dt><dd>${x.monthlyDownloads || 0}</dd></div><div><dt>今日下载</dt><dd>${x.dailyDownloads || 0}</dd></div></dl>${x.billingMode === 'subscription' ? '<div class="notice-inline">该策略为订阅制，发布者需要在程序中加入授权模块；如果无法自行完成，可联系平台官方微信获取技术支持。</div>' : ''}</article><section class="detail-report-section"><h3>测试数据图</h3><div class="detail-gallery"><figure><img src="${x.image}" alt="${esc(x.title)} 封面图"><figcaption>封面图</figcaption></figure><figure><img src="${x.dataImage}" alt="${esc(x.title)} 数据图"><figcaption>数据图</figcaption></figure></div></section><section class="detail-report-section"><h3>评论区</h3><div class="comment-list">${list.map((c)=>`<div class="comment"><strong>${esc(c.user)} ${c.bought?'<span class="badge green">已购买</span>':''}</strong><span>${esc(c.body)}</span></div>`).join('') || '<div class="empty">暂无评论。</div>'}</div><form id="comment-form" class="comment-form"><textarea id="comment-body" placeholder="发表你的问题或使用体验"></textarea><button class="btn primary">发布评论</button></form></section></section><aside class="panel detail-buy-panel"><h3>购买与下载</h3><div class="price detail-price">${billingPriceText(x)}</div><p class="muted">${billingLabel(x.billingMode)}</p><button class="btn primary full" data-buy="${x.id}">${x.purchased?'查看下载与帮助':'购买策略'}</button>${x.purchased&&x.downloadUrl?`<button class="btn full" data-download="${x.id}">下载策略文件</button>`:''}</aside></div>`;
}

function emailBindingBlock() {
  if (state.user.email) {
    return `<div class="profile-name-form locked-email"><div class="field"><label>绑定邮箱</label><div class="readonly-input">${esc(state.user.email)}</div></div><p class="muted">邮箱绑定后不可自行修改。如需变更登录邮箱，请联系管理员处理。</p></div>`;
  }
  return `<form id="email-form" class="form-grid profile-name-form"><div class="field"><label>绑定邮箱</label><div class="inline-control"><input id="email-input" type="email" value="" placeholder="输入登录邮箱"><button class="btn" type="button" data-send-bind-code ${codeCooldownLeft('bind')>0?'disabled':''}>${codeButtonLabel('bind')}</button></div></div><div class="field"><label>邮箱验证码</label><input id="email-code-input" inputmode="numeric" maxlength="6" placeholder="请输入 6 位验证码"></div><button class="btn primary" type="submit">保存邮箱</button></form>`;
}

function accountPage() {
  const mine = strategies.filter((x)=>x.owner===state.user.username && !x.ownerDeletedAt);
  const bought = strategies.filter((x)=>x.purchased);
  const avatar = state.user.avatarUrl ? `<img src="${state.user.avatarUrl}" alt="头像">` : `<span>${esc((state.user.displayName || state.user.username).slice(0,1).toUpperCase())}</span>`;
  const pendingCount = mine.filter(x=>x.status==='待审核').length;
  if (state.accountPanel === 'posts') {
    return `<div class="section-title"><div><h1>账户中心</h1></div><div class="actions"><button class="btn" data-account="overview">账户概览</button><button class="btn primary" data-account="posts">我的发帖</button></div></div><div class="account-posts-layout">${ownForumPostsPanel()}</div>`;
  }
  const mainPanel = `<div class="panel"><h3>我的购买</h3>${purchaseTable(bought)}</div><div class="panel"><h3>我的上传策略</h3>${uploadTable(mine)}</div>${ledgerTable()}`;
  return `<div class="section-title"><div><h1>账户中心</h1></div><div class="actions"><button class="btn ${state.accountPanel==='overview'?'primary':''}" data-account="overview">账户概览</button><button class="btn ${state.accountPanel==='posts'?'primary':''}" data-account="posts">我的发帖</button></div></div><div class="account-layout"><section class="panel account-info-panel"><h3>账户信息</h3><div class="avatar-row"><label class="avatar-uploader">${avatar}<input data-avatar type="file" accept="image/*" hidden></label><div><strong>${esc(state.user.displayName)}</strong><p class="muted">点击头像上传新图片</p></div></div><div class="account-info-list"><div class="account-info-line"><span>邮箱账号</span><strong>${esc(state.user.email || state.user.username)}</strong></div><button class="account-info-line clickable" type="button" data-account="overview"><span>账户余额</span><strong>${money(state.user.balance)}</strong></button><div class="account-info-line"><span>已购买策略</span><strong>${bought.length}</strong></div><div class="account-info-line"><span>上传策略</span><strong>${mine.length}</strong></div><div class="account-info-line"><span>待审核策略</span><strong>${pendingCount}</strong></div><div class="account-info-line"><span>账户类型</span><strong>普通用户 / 策略发布者</strong></div><div class="account-info-line"><span>上架规则</span><strong><span class="badge gold">管理员审核后上架</span></strong></div></div><form id="display-name-form" class="form-grid profile-name-form"><div class="field"><label>用户名</label><input id="display-name-input" value="${esc(state.user.displayName)}" maxlength="30" placeholder="输入社区显示用户名"></div><button class="btn primary" type="submit">保存用户名</button></form>${emailBindingBlock()}</section><section class="side-stack">${mainPanel}</section></div>`;
}
function purchaseTable(items){return `<div class="table-wrap"><table><thead><tr><th>策略</th><th>平台</th><th>操作</th></tr></thead><tbody>${items.map((x)=>`<tr><td>${esc(x.title)}</td><td>${esc(x.platform)}</td><td>${x.downloadUrl?`<button class="btn" data-download="${x.id}">下载文件</button>`:'暂无文件'}</td></tr>`).join('')||'<tr><td colspan="3">暂无购买。</td></tr>'}</tbody></table></div>`}
function ledgerTable(){return `<div class="panel"><h3>收支明细</h3><div class="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>对象</th><th>金额</th></tr></thead><tbody>${ledger.map((x)=>`<tr><td>${x.time}</td><td>${x.type}</td><td>${esc(x.target)}</td><td>${x.amount>0?'+':''}${money(x.amount)}</td></tr>`).join('')||'<tr><td colspan="4">暂无明细。</td></tr>'}</tbody></table></div></div>`}
function ownForumPostsPanel(){
  const mine = forumPosts.filter((post)=>String(post.userId)===String(state.user.id));
  return `<div class="panel"><h3>我的发帖</h3><div class="forum-manage-list">${mine.map((post)=>`<article class="forum-manage-item"><div class="forum-manage-main"><div class="forum-author-line"><span>${esc(forumSectionLabel(post.category))}</span><span>${esc(post.createdAt || '')}</span><span>回复 ${post.replyCount || (post.replies || []).length}</span></div><h4>${esc(post.title)}</h4><p>${esc(post.body)}</p></div><div class="actions forum-manage-actions"><button class="btn" data-forum-detail="${post.id}">查看</button><button class="btn danger" data-delete-forum-post="${post.id}">删除</button></div><form class="forum-reply-form account-reply-form" data-forum-reply="${post.id}"><input name="body" placeholder="回复这个帖子"><button class="btn primary">回复</button></form></article>`).join('') || '<div class="empty">你还没有发布帖子。</div>'}</div></div>`;
}

function uploadPage() {
  const mine = strategies.filter((x)=>x.owner===state.user.username && !x.ownerDeletedAt);
  return `<div class="section-title"><div><h1>上传我的策略</h1></div></div><div class="upload-layout"><section class="panel"><h3>上传新策略</h3>${strategyForm(false)}</section><aside class="panel"><h3>已上传策略</h3>${uploadTable(mine)}</aside></div>`;
}
function editStrategyPage() {
  const editing = strategies.find((x)=>x.id===state.editingStrategyId);
  if (!editing) return `<div class="section-title"><div><h1>编辑已上传策略</h1></div><button class="btn" data-section="account">返回账户中心</button></div><div class="empty">请选择需要编辑的策略。</div>`;
  return `<div class="section-title"><div><h1>编辑已上传策略</h1><p>${esc(editing.title)}</p></div><button class="btn" type="button" data-cancel-edit>取消编辑</button></div><section class="panel edit-strategy-panel">${strategyForm(true)}</section>`;
}
function strategyForm(editing){
  const form = state.uploadForm;
  const subscriptionNotice = form.billingMode === 'subscription' ? '<div class="notice-inline">订阅制策略需要在程序中加入授权模块，用于控制订阅有效期和下载后的使用权限。如果无法自行完成，可联系我们提供技术支持。</div>' : '';
  return `<form id="upload-form" class="form-grid"><div class="field"><label>策略名称</label><input id="strategy-title" data-upload-field required value="${esc(form.title)}" placeholder="请输入你的策略名称"></div><div class="field"><label>交易类型</label><select id="strategy-type" data-upload-field>${types.filter((t)=>t!=='全部').map((t)=>`<option ${form.type===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="field"><label>适用平台</label><input id="strategy-platform" data-upload-field required value="${esc(form.platform)}" placeholder="例如 MT5 / CTP / Binance API"></div><div class="field"><label>定价</label><input id="strategy-price" data-upload-field type="number" min="0" step="0.01" required value="${esc(form.price)}" placeholder="请输入策略定价"></div><div class="field"><label>收费方式</label><select id="strategy-billing" data-upload-field data-billing-mode><option value="one_time" ${form.billingMode==='one_time'?'selected':''}>一次性收费</option><option value="subscription" ${form.billingMode==='subscription'?'selected':''}>订阅制</option></select></div>${subscriptionNotice}<div class="field"><label>发布者联系方式</label><input id="seller-contact" data-upload-field required value="${esc(form.sellerContact)}" placeholder="微信、QQ、邮箱或其他售后联系方式"></div><div class="field"><label>简介</label><textarea id="strategy-desc" data-upload-field required placeholder="请输入策略简介、适用行情、核心逻辑和风险说明">${esc(form.desc)}</textarea></div><div class="image-upload-grid">${uploadBox('cover','封面图')}${uploadBox('backtest','回测图')}${uploadBox('data','数据图')}</div>${programBox()}<button class="btn primary">${editing?'保存并提交审核':'提交管理员审核'}</button></form>`;
}
function uploadBox(id,label){const p=state.uploadPreview[id];return `<label class="upload-box">${p?`<img class="upload-preview" src="${p}" alt="${label}">`:`<span>${label}<br><small>选择图片上传</small></span>`}<input data-image="${id}" type="file" accept="image/*" hidden></label>`}
function programBox(){const f=state.programFile;const editing=strategies.find((x)=>x.id===state.editingStrategyId);const existingName=editing?.programName;return `<label class="upload-box program-upload"><span><strong>${f?esc(f.originalName):existingName?esc(existingName):'策略编译后程序'}</strong><br><small>${f?`${Math.ceil(f.size/1024)} KB，已上传到后端`:existingName?'可重新选择文件替换当前程序':'选择 .ex5 / .ex4 / .zip / .dll / .set 文件'}</small></span><input data-program type="file" accept=".ex4,.ex5,.zip,.dll,.set" hidden></label>`}
function uploadTable(items){ if(!items.length)return '<div class="empty">还没有上传策略。</div>'; return `<div class="table-wrap"><table><thead><tr><th>策略</th><th>价格</th><th>收费方式</th><th>文件</th><th>状态</th><th>操作</th></tr></thead><tbody>${items.map((x)=>`<tr><td>${esc(x.title)}</td><td>${billingPriceText(x)}</td><td>${billingLabel(x.billingMode)}</td><td>${x.hasFile?'<span class="badge green">已上传</span>':'<span class="badge gold">未上传</span>'}</td><td><span class="badge ${x.status==='已上架'?'green':'gold'}">${x.status}</span></td><td><div class="actions table-actions"><button class="btn" data-edit-strategy="${x.id}">编辑</button>${x.status==='已上架'?`<button class="btn" data-toggle="${x.id}">下架</button>`:x.status==='已下架'?`<button class="btn danger" data-delete-strategy="${x.id}">删除</button>`:''}${x.status!=='已上架'&&x.status!=='已下架'?'<span class="muted">等待管理员审核</span>':''}</div></td></tr>`).join('')}</tbody></table></div>`}
function helpPage(){const bought=strategies.filter((x)=>x.purchased);return `<div class="section-title"><div><h1>购买后帮助</h1></div></div><div class="detail-layout"><section class="side-stack">${bought.map((x)=>`<div class="panel"><div class="strategy-header"><h3>${esc(x.title)}</h3>${x.downloadUrl?`<button class="btn primary" data-download="${x.id}">下载策略文件</button>`:'<span class="badge gold">暂无文件</span>'}</div><p class="muted">按 ${esc(x.platform)} 完成部署，并先用小资金验证参数。</p></div>`).join('')||'<div class="empty">购买策略后，这里会显示文件下载和部署帮助。</div>'}</section><aside class="panel"><h3>官方微信支持</h3><div class="upload-box wx-box"><strong>WX-ADMIN-888</strong></div></aside></div>`}

function adminApp(){ const pages={overview:adminOverview,reviews:adminReviews,finance:adminFinance,customers:adminCustomers,blockedWords:adminBlockedWords,settings:adminSettings}; return `<div class="admin-app-layout"><aside class="admin-sidebar"><div class="brand-row"><div class="brand-mark">AD</div><div><strong>Admin Console</strong><span>系统管理后台</span></div></div><nav class="nav">${adminNav('overview','概览')}${adminNav('customers','客户管理')}${adminNav('finance','财务管理')}${adminNav('reviews','策略审核')}${adminNav('blockedWords','敏感词')}${adminNav('settings','系统配置')}</nav><div class="sidebar-footer"><div class="user-chip"><strong>${esc(state.user.displayName)}</strong><span>管理员账户</span></div><button class="btn ghost" data-logout>退出后台</button></div></aside><section class="workspace"><header class="topbar"><div><h1>管理员后台</h1><p class="muted">只显示后台管理所需功能。</p></div><a class="btn" href="index.html">用户入口</a></header><main class="main">${(pages[state.adminSection]||adminOverview)()}</main></section></div>`}
function adminNav(id,label){return `<button class="nav-button ${state.adminSection===id?'active':''}" data-admin="${id}">${label}</button>`}
function adminMetrics(){return adminData.metrics||{totalCustomers:0,todayNewCustomers:0,weekNewCustomers:0,monthNewCustomers:0,todaySales:0,weekSales:0,monthSales:0,totalSales:0,technicalPendingWithdrawal:0}}
function adminCustomerType(user){return Number(user.strategy_count||0)>0?'技术方 / 策略顾问':'普通客户'}
function adminOverview(){const m=adminMetrics();return `<div class="section-title"><div><h1>后台概览</h1></div></div><div class="metrics-grid">${metric('今日新增客户',m.todayNewCustomers)}${metric('本周新增客户',m.weekNewCustomers)}${metric('本月新增客户',m.monthNewCustomers)}${metric('今日新增销售额',money(m.todaySales))}${metric('本周新增销售额',money(m.weekSales))}${metric('本月新增销售额',money(m.monthSales))}${metric('技术方待提现',money(m.technicalPendingWithdrawal))}${metric('待审核策略',strategies.filter(x=>x.status==='待审核').length)}</div><div class="panel"><h3>待处理策略</h3>${adminStrategyTable(strategies.filter(x=>x.status==='待审核'))}</div>`}
function adminReviews(){return `<div class="section-title"><div><h1>策略审核</h1></div></div><div class="panel">${adminStrategyTable(strategies)}</div>`}
function adminStrategyTable(items){return `<div class="table-wrap"><table><thead><tr><th>策略</th><th>作者</th><th>价格</th><th>收费方式</th><th>联系方式</th><th>文件</th><th>状态</th><th>操作</th></tr></thead><tbody>${items.map((x)=>`<tr><td>${esc(x.title)}</td><td>${esc(x.author)}</td><td>${billingPriceText(x)}</td><td>${billingLabel(x.billingMode)}</td><td>${esc(x.sellerContact || '-')}</td><td>${x.hasFile?'已上传':'缺文件'}</td><td>${x.status}</td><td><button class="btn" data-approve="${x.id}">通过</button> <button class="btn danger" data-offline="${x.id}">下架</button></td></tr>`).join('')||'<tr><td colspan="8">暂无策略。</td></tr>'}</tbody></table></div>`}
function adminCustomers(){const m=adminMetrics();const customers=adminData.users.filter(x=>x.role!=='admin');const strategyTotal=customers.reduce((sum,x)=>sum+Number(x.strategy_count||0),0);const listedTotal=customers.reduce((sum,x)=>sum+Number(x.listed_strategy_count||0),0);const pendingTotal=customers.reduce((sum,x)=>sum+Number(x.pending_strategy_count||0),0);return `<div class="section-title"><div><h1>客户管理</h1></div></div><div class="metrics-grid">${metric('客户总数',m.totalCustomers)}${metric('今日新增客户',m.todayNewCustomers)}${metric('本周新增客户',m.weekNewCustomers)}${metric('本月新增客户',m.monthNewCustomers)}${metric('客户上传策略',strategyTotal)}${metric('已上架策略',listedTotal)}${metric('待审核策略',pendingTotal)}</div><div class="panel"><h3>客户列表</h3><div class="table-wrap"><table><thead><tr><th>账号</th><th>邮箱</th><th>用户名</th><th>客户类型</th><th>余额</th><th>上传策略</th><th>已上架</th><th>待审核</th><th>成交单数</th><th>策略销售额</th><th>注册时间</th><th>状态</th></tr></thead><tbody>${customers.map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.email || '-')}</td><td>${esc(x.display_name)}</td><td>${adminCustomerType(x)}</td><td>${money(x.balance)}</td><td>${x.strategy_count||0}</td><td>${x.listed_strategy_count||0}</td><td>${x.pending_strategy_count||0}</td><td>${x.strategy_paid_orders||0}</td><td>${money(x.strategy_sales||0)}</td><td>${esc(x.created_at || '-')}</td><td>${x.status}</td></tr>`).join('')||'<tr><td colspan="12">暂无客户。</td></tr>'}</tbody></table></div></div>`}
function adminFinance(){const m=adminMetrics();const tech=adminData.technicalAccounts||[];return `<div class="section-title"><div><h1>财务管理</h1></div></div><div class="metrics-grid">${metric('今日新增销售额',money(m.todaySales))}${metric('本周新增销售额',money(m.weekSales))}${metric('本月新增销售额',money(m.monthSales))}${metric('累计销售额',money(m.totalSales))}${metric('技术方待提现',money(m.technicalPendingWithdrawal))}</div><div class="admin-layout"><section class="panel"><h3>订单明细</h3><div class="table-wrap"><table><thead><tr><th>订单号</th><th>买家</th><th>技术方/策略方</th><th>策略</th><th>金额</th><th>状态</th></tr></thead><tbody>${adminData.orders.map(x=>`<tr><td>${esc(x.order_no)}</td><td>${esc(x.buyer_username)}</td><td>${esc(x.seller_username || '-')}</td><td>${esc(x.strategy_title)}</td><td>${money(x.amount)}</td><td>${x.status}</td></tr>`).join('')||'<tr><td colspan="6">暂无订单。</td></tr>'}</tbody></table></div></section><section class="panel"><h3>技术方待提现</h3><div class="table-wrap"><table><thead><tr><th>账号</th><th>用户名</th><th>策略数</th><th>已上架</th><th>可提现余额</th></tr></thead><tbody>${tech.map(x=>`<tr><td>${esc(x.username)}</td><td>${esc(x.display_name)}</td><td>${x.strategy_count}</td><td>${x.listed_count}</td><td>${money(x.balance)}</td></tr>`).join('')||'<tr><td colspan="5">暂无待提现技术方。</td></tr>'}</tbody></table></div></section></div>`}
function adminBlockedWords(){const words=adminData.blockedWords||[];return `<div class="section-title"><div><h1>敏感词管理</h1><p>屏蔽词会同时作用于论坛帖子、论坛回复和策略评论区。</p></div></div><div class="admin-layout"><section class="panel"><h3>新增屏蔽词</h3><form id="blocked-word-form" class="inline-control"><input id="blocked-word-input" maxlength="120" placeholder="输入需要屏蔽的词"><button class="btn primary">添加</button></form><p class="muted">用户发布内容后，命中的词会显示为 ***。</p></section><section class="panel"><h3>当前屏蔽词</h3><div class="word-list">${words.map((x)=>`<div class="word-item"><div><strong>${esc(x.word)}</strong><span class="muted">${esc(x.status)} · ${esc(x.created_at || '')}</span></div><button class="btn danger small" data-delete-word="${x.id}">删除</button></div>`).join('')||'<div class="empty">暂无屏蔽词。</div>'}</div></section></div>`}
function adminSettings(){return `<div class="section-title"><div><h1>系统配置</h1></div></div><div class="admin-layout"><section class="panel"><h3>支付接口</h3><div class="field"><label>支付回调地址</label><input value="/api/payments/callback"></div><button class="btn primary" data-toast="系统配置已保存">保存配置</button></section><aside class="panel"><h3>官方微信</h3><input value="WX-ADMIN-888"></aside></div>`}
function payModal(){
  const x=strategies.find(s=>s.id===state.modal);
  if(!x)return '';
  const balance=Number(state.user.balance||0);
  const price=Number(x.price||0);
  const after=balance-price;
  return `<div class="modal open"><div class="modal-card purchase-modal"><div class="modal-head"><div><h2>确认购买</h2><p>请确认策略信息和账户扣款金额</p></div><button class="icon-btn" data-close>关闭</button></div><div class="purchase-content"><section class="purchase-summary"><div class="purchase-title-row"><div><span class="muted">策略名称</span><h3>${esc(x.title)}</h3></div><span class="badge gold">${x.type}</span></div><p>${esc(x.desc)}</p><dl class="purchase-specs"><div><dt>适用平台</dt><dd>${esc(x.platform)}</dd></div><div><dt>收费方式</dt><dd>${billingLabel(x.billingMode)}</dd></div><div><dt>程序文件</dt><dd>${x.hasFile?'购买后可下载':'暂未上传'}</dd></div><div><dt>交付方式</dt><dd>支付成功后进入部署帮助页</dd></div></dl>${x.billingMode === 'subscription' ? '<p class="notice-inline">该策略为订阅制，程序应包含授权模块以控制订阅权限。</p>' : ''}</section><aside class="purchase-checkout"><div class="checkout-line total"><span>应付金额</span><strong>${billingPriceText(x)}</strong></div><div class="checkout-line"><span>当前余额</span><strong>${money(balance)}</strong></div><div class="checkout-line"><span>支付后余额</span><strong class="${after<0?'danger-text':''}">${money(after)}</strong></div>${after<0?'<p class="error-text">余额不足，请先充值或接入正式支付渠道。</p>':'<p class="muted">确认后将创建订单并开通该策略文件下载权限。</p>'}<div class="purchase-actions"><button class="btn" data-close>取消</button><button class="btn primary" data-pay="${x.id}" ${after<0?'disabled':''}>确认支付</button></div></aside></div></div></div>`;
}
function postComposerModal(){
  const current = state.forumSection === 'all' ? 'general' : state.forumSection;
  const options = forumSections.filter((item) => item.id !== 'all').map((item) => `<option value="${item.id}" ${current === item.id ? 'selected' : ''}>${item.label}</option>`).join('');
  return `<div class="modal open"><div class="modal-card post-composer-modal"><div class="composer-head"><h2>发帖</h2><button class="icon-btn composer-close" type="button" data-close-post>关闭</button></div><form id="forum-post-form" class="post-composer-form"><div class="field composer-bar"><label>发布到区</label><select id="forum-category">${options}</select></div><input id="forum-title" class="composer-title-input" maxlength="160" placeholder="必填，请输入帖子标题"><textarea id="forum-body" class="composer-body" placeholder="请输入正文"></textarea><div class="composer-foot"><span></span><button class="btn primary composer-submit">发布</button></div></form></div></div>`;
}

function bind(){
  document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>{state.authMode=b.dataset.auth;render()});
  document.querySelectorAll('[data-section]').forEach(b=>b.onclick=()=>{state.section=b.dataset.section;if(state.section==='upload'){state.editingStrategyId=null;state.uploadPreview={};state.uploadUrls={};state.programFile=null;resetUploadForm()}render()});
  document.querySelectorAll('[data-admin]').forEach(b=>b.onclick=()=>{state.adminSection=b.dataset.admin;render()});
  document.querySelector('[data-sidebar-toggle]')?.addEventListener('click', toggleSidebar);
  document.querySelector('[data-logout]')?.addEventListener('click', logout);
  document.querySelector('#login-form')?.addEventListener('submit', loginUser);
  document.querySelector('#admin-login-form')?.addEventListener('submit', loginAdmin);
  document.querySelector('#register-form')?.addEventListener('submit', registerUser);
  document.querySelector('#reset-form')?.addEventListener('submit', resetPassword);
  document.querySelector('[data-send-register-code]')?.addEventListener('click', sendRegisterCode);
  document.querySelector('[data-send-reset-code]')?.addEventListener('click', sendResetCode);
  document.querySelector('#search')?.addEventListener('input',e=>{state.searchDraft=e.target.value});
  document.querySelector('[data-search]')?.addEventListener('click', applySearch);
  document.querySelector('#forum-search')?.addEventListener('input',e=>{state.forumSearchDraft=e.target.value});
  document.querySelector('[data-forum-search]')?.addEventListener('click', applyForumSearch);
  document.querySelector('#forum-section-filter')?.addEventListener('change',e=>{state.forumSection=e.target.value;state.section='forum';render()});
  document.querySelectorAll('[data-market-home]').forEach(b=>b.addEventListener('click', resetMarket));
  document.querySelector('#type-filter')?.addEventListener('change',e=>{state.type=e.target.value;state.section='market';render()});
  document.querySelector('#sort-filter')?.addEventListener('change',e=>{state.sort=e.target.value;render()});
  document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{state.type=b.dataset.type;render()});
  document.querySelectorAll('[data-detail]').forEach(el=>{
    el.onclick=(e)=>{e.stopPropagation();state.detailId=el.dataset.detail;state.section='detail';render()};
    el.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}};
  });
  document.querySelectorAll('[data-forum-detail]').forEach(el=>{
    el.onclick=()=>{state.forumDetailId=el.dataset.forumDetail;state.section='forumDetail';render()};
    el.onkeydown=(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click()}};
  });
  document.querySelectorAll('[data-buy]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();const x=strategies.find(s=>s.id===b.dataset.buy); if(x?.purchased){state.section='help'}else{state.modal=b.dataset.buy} render()});
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{state.modal=null;render()}));
  document.querySelector('[data-open-post]')?.addEventListener('click',()=>{state.postComposer=true;render()});
  document.querySelector('[data-close-post]')?.addEventListener('click',()=>{state.postComposer=false;render()});
  document.querySelectorAll('[data-forum-section]').forEach(b=>b.onclick=()=>{state.forumSection=b.dataset.forumSection;state.section='forum';render()});
  document.querySelector('[data-pay]')?.addEventListener('click',()=>purchase(document.querySelector('[data-pay]').dataset.pay));
  document.querySelector('#upload-form')?.addEventListener('submit', submitStrategy);
  document.querySelectorAll('[data-upload-field]').forEach((input)=> {
    input.addEventListener('input', saveUploadForm);
    input.addEventListener('change', saveUploadForm);
  });
  document.querySelector('[data-billing-mode]')?.addEventListener('change',()=>{saveUploadForm();render()});
  document.querySelectorAll('[data-image]').forEach(i=>i.onchange=()=>uploadImage(i));
  document.querySelector('[data-program]')?.addEventListener('change', uploadProgram);
  document.querySelector('[data-avatar]')?.addEventListener('change', uploadAvatar);
  document.querySelector('#display-name-form')?.addEventListener('submit', updateDisplayName);
  document.querySelector('#email-form')?.addEventListener('submit', updateEmail);
  document.querySelector('[data-send-bind-code]')?.addEventListener('click', sendBindEmailCode);
  document.querySelector('#comment-form')?.addEventListener('submit', addComment);
  document.querySelector('#forum-post-form')?.addEventListener('submit', createForumPost);
  document.querySelectorAll('[data-forum-reply]').forEach(form=>form.addEventListener('submit', replyForumPost));
  document.querySelector('[data-cancel-edit]')?.addEventListener('click', cancelEditStrategy);
  document.querySelectorAll('[data-edit-strategy]').forEach(b=>b.onclick=()=>editStrategy(b.dataset.editStrategy));
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>ownerStatus(b.dataset.toggle));
  document.querySelectorAll('[data-delete-strategy]').forEach(b=>b.onclick=()=>deleteStrategy(b.dataset.deleteStrategy));
  document.querySelectorAll('[data-delete-forum-post]').forEach(b=>b.onclick=()=>deleteForumPost(b.dataset.deleteForumPost));
  document.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>adminStatus(b.dataset.approve,'listed'));
  document.querySelectorAll('[data-offline]').forEach(b=>b.onclick=()=>adminStatus(b.dataset.offline,'unlisted'));
  document.querySelector('#blocked-word-form')?.addEventListener('submit', addBlockedWord);
  document.querySelectorAll('[data-delete-word]').forEach(b=>b.onclick=()=>deleteBlockedWord(b.dataset.deleteWord));
  document.querySelectorAll('[data-download]').forEach(b=>b.onclick=()=>downloadFile(b.dataset.download));
  document.querySelectorAll('[data-account]').forEach(b=>b.onclick=()=>{state.accountPanel=b.dataset.account;render()});
  document.querySelectorAll('[data-toast]').forEach(b=>b.onclick=()=>toastMsg(b.dataset.toast));
  updateEmailCodeButtons();
}
function toggleSidebar(){
  state.sidebarCollapsed=!state.sidebarCollapsed;
  localStorage.setItem(sidebarKey,state.sidebarCollapsed?'1':'0');
  document.querySelector('.app-layout')?.classList.toggle('sidebar-collapsed',state.sidebarCollapsed);
  const button=document.querySelector('[data-sidebar-toggle]');
  if(button){
    const label=state.sidebarCollapsed?'展开导航栏':'折叠导航栏';
    button.dataset.tooltip=label;
    button.setAttribute('aria-label',label);
  }
}
async function loginUser(e){e.preventDefault();try{const r=await api('/api/login',{method:'POST',body:JSON.stringify({email:document.querySelector('#login-email').value.trim(),password:document.querySelector('#password').value})});await enter(r.token)}catch(err){document.querySelector('#login-error').textContent=err.message}}
async function loginAdmin(e){e.preventDefault();try{const r=await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:document.querySelector('#admin-username').value.trim(),password:document.querySelector('#admin-password').value})});await enter(r.token)}catch(err){document.querySelector('#admin-login-error').textContent=err.message}}
async function sendRegisterCode(){const email=document.querySelector('#reg-email')?.value.trim();try{await api('/api/email/register-code',{method:'POST',body:JSON.stringify({email})});startEmailCodeCooldown('register');toastMsg('验证码已发送，请查看邮箱')}catch(err){syncCooldownFromError('register',err.message);document.querySelector('#register-error').textContent=err.message}}
async function registerUser(e){e.preventDefault();const errorEl=document.querySelector('#register-error');const password=document.querySelector('#reg-password').value;const confirmPassword=document.querySelector('#reg-password-confirm').value;if(password!==confirmPassword){errorEl.textContent='两次输入的密码不一致';return}try{const r=await api('/api/register',{method:'POST',body:JSON.stringify({email:document.querySelector('#reg-email').value.trim(),emailCode:document.querySelector('#reg-email-code').value.trim(),displayName:document.querySelector('#reg-name').value.trim(),password,confirmPassword})});await enter(r.token)}catch(err){errorEl.textContent=err.message}}
async function sendResetCode(){const email=document.querySelector('#reset-email')?.value.trim();try{await api('/api/password-reset/send-code',{method:'POST',body:JSON.stringify({email})});startEmailCodeCooldown('reset');toastMsg('验证码已发送，请查看邮箱')}catch(err){syncCooldownFromError('reset',err.message);document.querySelector('#reset-error').textContent=err.message}}
async function resetPassword(e){e.preventDefault();const errorEl=document.querySelector('#reset-error');const password=document.querySelector('#reset-password').value;const confirmPassword=document.querySelector('#reset-password-confirm').value;if(password!==confirmPassword){errorEl.textContent='两次输入的密码不一致';return}try{await api('/api/password-reset/confirm',{method:'POST',body:JSON.stringify({email:document.querySelector('#reset-email').value.trim(),code:document.querySelector('#reset-code').value.trim(),password,confirmPassword})});toastMsg('密码已修改，请重新登录');state.authMode='login';render()}catch(err){errorEl.textContent=err.message}}
async function enter(token){state.token=token;localStorage.setItem(tokenKey,token);await refresh();render()}
function logout(){state.user=null;state.token='';state.authMode='login';localStorage.removeItem(tokenKey);render()}
async function submitStrategy(e){
  e.preventDefault();
  saveUploadForm();
  const title = state.uploadForm.title.trim();
  const type = state.uploadForm.type;
  const platform = state.uploadForm.platform.trim();
  const priceInput = state.uploadForm.price.trim();
  const price = Number(priceInput);
  const billingMode = state.uploadForm.billingMode || 'one_time';
  const sellerContact = state.uploadForm.sellerContact.trim();
  const desc = state.uploadForm.desc.trim();
  if(!title||!platform||!priceInput||!Number.isFinite(price)||price<0||!sellerContact||!desc)return toastMsg('请填写策略名称、平台、定价、联系方式和简介');
  if(!state.editingStrategyId&&!state.programFile)return toastMsg('请先上传策略编译后程序文件，例如 .ex5');
  try{
    const wasEditing=Boolean(state.editingStrategyId);
    const payload={title,type:tradeTypeCodes[type]||'other',platform,price,billingMode,sellerContact,desc,images:state.uploadUrls,programFile:state.programFile};
    const r=await api(state.editingStrategyId?`/api/strategies/${state.editingStrategyId}`:'/api/strategies',{method:state.editingStrategyId?'PUT':'POST',body:JSON.stringify(payload)});
    applyData(r.bootstrap);
    state.uploadPreview={};
    state.uploadUrls={};
    state.programFile=null;
    state.editingStrategyId=null;
    resetUploadForm();
    state.detailId=String(r.strategyId);
    state.section='detail';
    toastMsg(wasEditing?'策略已保存并提交审核':'策略已提交审核');
    render();
  }catch(err){toastMsg(err.message)}
}
async function uploadImage(input){saveUploadForm();const file=input.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{state.uploadPreview[input.dataset.image]=reader.result;render()};reader.readAsDataURL(file);try{const form=new FormData();form.append('originalName',file.name);form.append('image',file);const r=await api('/api/uploads',{method:'POST',body:form});state.uploadUrls[input.dataset.image]=r.file.url;toastMsg('图片已上传')}catch(err){toastMsg(err.message)}}
async function addComment(e){e.preventDefault();const body=document.querySelector('#comment-body').value.trim();if(!body)return toastMsg('评论不能为空');try{const r=await api('/api/comments',{method:'POST',body:JSON.stringify({strategyId:state.detailId,body})});applyData(r.bootstrap);toastMsg('评论已发布');render()}catch(err){toastMsg(err.message)}}
async function createForumPost(e){e.preventDefault();const title=document.querySelector('#forum-title')?.value.trim();const body=document.querySelector('#forum-body')?.value.trim();const category=document.querySelector('#forum-category')?.value||'general';if(!title||!body)return toastMsg('请填写帖子标题和内容');try{const r=await api('/api/forum/posts',{method:'POST',body:JSON.stringify({title,body,category})});applyData(r.bootstrap);state.forumSection=category;state.postComposer=false;toastMsg('帖子已发布');render()}catch(err){toastMsg(err.message)}}
async function replyForumPost(e){e.preventDefault();const form=e.currentTarget;const body=form.querySelector('[name="body"]')?.value.trim();if(!body)return toastMsg('回复内容不能为空');try{const r=await api('/api/forum/replies',{method:'POST',body:JSON.stringify({postId:form.dataset.forumReply,body})});applyData(r.bootstrap);toastMsg('回复已发布');render()}catch(err){toastMsg(err.message)}}
function editableUrl(v){return typeof v==='string'&&v.startsWith('/uploads/')?v:null}
function editStrategy(id){const x=strategies.find(s=>s.id===id);if(!x)return;state.section='editStrategy';state.editingStrategyId=id;state.uploadForm={title:x.title||'',type:x.type||'外汇EA',platform:x.platform||'',price:String(x.price??''),billingMode:x.billingMode||'one_time',sellerContact:x.sellerContact||'',desc:x.desc||''};state.uploadPreview={cover:x.image,backtest:x.backtestImage,data:x.dataImage};state.uploadUrls={};const cover=editableUrl(x.image);const backtest=editableUrl(x.backtestImage);const data=editableUrl(x.dataImage);if(cover)state.uploadUrls.cover=cover;if(backtest)state.uploadUrls.backtest=backtest;if(data)state.uploadUrls.data=data;state.programFile=null;render()}
function cancelEditStrategy(){state.editingStrategyId=null;state.uploadPreview={};state.uploadUrls={};state.programFile=null;resetUploadForm();state.section='account';render()}
async function updateDisplayName(e){e.preventDefault();const displayName=document.querySelector('#display-name-input').value.trim();if(displayName.length<2||displayName.length>30)return toastMsg('用户名长度需要为 2-30 个字符');try{const r=await api('/api/profile/name',{method:'POST',body:JSON.stringify({displayName})});applyData(r.bootstrap);toastMsg('用户名已更新');render()}catch(err){toastMsg(err.message)}}
async function sendBindEmailCode(){const email=document.querySelector('#email-input')?.value.trim();try{await api('/api/profile/email/send-code',{method:'POST',body:JSON.stringify({email})});startEmailCodeCooldown('bind');toastMsg('验证码已发送，请查看邮箱')}catch(err){syncCooldownFromError('bind',err.message);toastMsg(err.message)}}
async function updateEmail(e){e.preventDefault();const email=document.querySelector('#email-input').value.trim();const code=document.querySelector('#email-code-input').value.trim();try{const r=await api('/api/profile/email/bind',{method:'POST',body:JSON.stringify({email,code})});applyData(r.bootstrap);toastMsg('邮箱已更新，下次登录请使用新邮箱');render()}catch(err){toastMsg(err.message)}}
async function uploadAvatar(e){const file=e.target.files?.[0];if(!file)return;try{const form=new FormData();form.append('originalName',file.name);form.append('image',file);const uploaded=await api('/api/uploads',{method:'POST',body:form});const r=await api('/api/profile/avatar',{method:'POST',body:JSON.stringify({avatarUrl:uploaded.file.url})});applyData(r.bootstrap);toastMsg('头像已更新');render()}catch(err){toastMsg(err.message)}}
async function uploadProgram(e){saveUploadForm();const file=e.target.files?.[0];if(!file)return;try{const form=new FormData();form.append('originalName',file.name);form.append('program',file);const r=await api('/api/strategy-files',{method:'POST',body:form});state.programFile=r.file;toastMsg('策略程序文件已上传');render()}catch(err){toastMsg(err.message)}}
async function ownerStatus(id){const x=strategies.find(s=>s.id===id);if(!x)return;try{const r=await api('/api/strategy-status',{method:'POST',body:JSON.stringify({strategyId:id,status:x.status==='已上架'?'unlisted':'listed'})});applyData(r.bootstrap);render()}catch(err){toastMsg(err.message)}}
async function deleteStrategy(id){const x=strategies.find(s=>s.id===id);if(!x)return;if(!confirm(`确定删除已下架策略「${x.title}」吗？删除后将不再显示在你的上传列表中。`))return;try{const r=await api(`/api/strategies/${id}`,{method:'DELETE'});applyData(r.bootstrap);toastMsg('策略已删除');render()}catch(err){toastMsg(err.message)}}
async function deleteForumPost(id){const post=forumPosts.find(x=>x.id===id);if(!post)return;if(!confirm(`确定删除帖子「${post.title}」吗？删除后将不再显示。`))return;try{const r=await api(`/api/forum/posts/${id}`,{method:'DELETE'});applyData(r.bootstrap);toastMsg('帖子已删除');render()}catch(err){toastMsg(err.message)}}
async function adminStatus(id,status){try{const r=await api('/api/admin/strategy-status',{method:'POST',body:JSON.stringify({strategyId:id,status})});applyData(r.bootstrap);render()}catch(err){toastMsg(err.message)}}
async function addBlockedWord(e){e.preventDefault();const word=document.querySelector('#blocked-word-input')?.value.trim();if(!word)return toastMsg('请输入屏蔽词');try{const r=await api('/api/admin/blocked-words',{method:'POST',body:JSON.stringify({word})});applyData(r.bootstrap);toastMsg('屏蔽词已添加');render()}catch(err){toastMsg(err.message)}}
async function deleteBlockedWord(id){try{const r=await api(`/api/admin/blocked-words/${id}`,{method:'DELETE'});applyData(r.bootstrap);toastMsg('屏蔽词已删除');render()}catch(err){toastMsg(err.message)}}
async function purchase(id){try{const r=await api('/api/purchase',{method:'POST',body:JSON.stringify({strategyId:id})});applyData(r.bootstrap);state.modal=null;state.section='help';render()}catch(err){toastMsg(err.message)}}
async function downloadFile(id){const x=strategies.find(s=>s.id===id);if(!x?.downloadUrl)return toastMsg('该策略暂无可下载文件');const res=await fetch(x.downloadUrl,{headers:{Authorization:`Bearer ${state.token}`}});if(!res.ok)return toastMsg('下载失败');const blob=await res.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=x.programName||`${x.title}.zip`;a.click();URL.revokeObjectURL(url)}
async function init(){if(state.token){try{await refresh();if(isAdminEntry&&!isAdmin())return logout();if(!isAdminEntry&&isAdmin())return logout()}catch{return logout()}}render()}
init();





