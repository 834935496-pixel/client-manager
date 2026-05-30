const API = "";
let token = localStorage.getItem("access_token") || "";
let currentPage = "today";
let currentCompanyId = null;
let currentTab = "info";
let _equityData = null;
let _equityNodeMap = {};
let currentContacts = [];
let chatHistory = [];

// ── Auth ──────────────────────────────────────────────────────────────────────

function showLogin() {
  token = "";
  localStorage.removeItem("access_token");
  document.getElementById("login-page").style.display = "block";
}

async function checkAuth() {
  try {
    if (!token) {
      const res = await fetch(`${API}/api/auth`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "" }),
      });
      if (res.ok) { token = ""; init(); return; }
      showLogin();
      return;
    }
    init();
  } catch (_) {
    showLogin();
  }
}

async function doLogin() {
  const pwd = document.getElementById("login-pwd").value;
  const res = await fetch(`${API}/api/auth`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pwd }),
  });
  if (res.ok) {
    const data = await res.json();
    token = data.token;
    localStorage.setItem("access_token", token);
    document.getElementById("login-page").style.display = "none";
    init();
  } else {
    document.getElementById("login-err").textContent = "密码错误，请重试";
  }
}

function apiFetch(path, opts = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Access-Token": token, ...(opts.headers || {}) },
  }).then(res => {
    if (res.status === 401) { showLogin(); throw new Error("401"); }
    return res;
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

const CLIENT_VERSION = "61";

async function checkVersion() {
  try {
    const res = await fetch("/api/version");
    if (!res.ok) return;
    const data = await res.json();
    const vEl = document.getElementById("app-version");
    if (vEl && data.version) vEl.textContent = `v${data.version}`;
    if (data.version && data.version !== CLIENT_VERSION) {
      if (sessionStorage.getItem("sv") === data.version) return;
      sessionStorage.setItem("sv", data.version);
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      location.reload(true);
    }
  } catch (_) {}
}

function init() {
  checkVersion();
  document.getElementById("today-date").textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  navTo("today");
}

// ── Navigation ────────────────────────────────────────────────────────────────

function navTo(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  document.querySelector(`[data-page="${page}"]`)?.classList.add("active");
  currentPage = page;
  document.getElementById("fab").style.display = ["today", "companies"].includes(page) ? "flex" : "none";
  document.getElementById("ai-chat-input-bar").style.display = page === "ai" ? "block" : "none";
  if (page === "today") loadToday();
  if (page === "companies") loadCompanies();
  if (page === "ai") loadAiCompanySelector();
}

function showPage(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(`page-${page}`).classList.add("active");
  document.getElementById("ai-chat-input-bar").style.display = "none";
}

// ── Today ─────────────────────────────────────────────────────────────────────

async function loadToday() {
  const today = todayISO();
  const res = await apiFetch(`/api/todos`);
  const all = await res.json();
  const pending = all.filter((t) => !t.done && t.date <= today && (!t.end_date || t.end_date >= today));
  renderTodayTodos(pending);
}

function renderTodayTodos(todos) {
  const el = document.getElementById("today-todos");
  if (!todos.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>今日暂无待办</p></div>';
    return;
  }
  el.innerHTML = todos.map((t) => renderTodoItem(t, "today")).join("");
}

async function loadDailyBrief() {
  const area = document.getElementById("daily-brief-area");
  area.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const res = await apiFetch("/api/ai/daily-brief");
  const data = await res.json();
  area.innerHTML = `<div class="brief-box"><div class="brief-title">🤖 AI 每日简报</div><div class="brief-content">${escHtml(data.reply)}</div></div>`;
}

// ── Companies ─────────────────────────────────────────────────────────────────

let searchTimer = null;

async function loadCompanies(q = "") {
  const res = await apiFetch(`/api/companies?q=${encodeURIComponent(q)}`);
  const companies = await res.json();
  renderCompaniesList(companies);
}

function searchCompanies(q) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCompanies(q), 300);
}

function renderCompaniesList(companies) {
  const el = document.getElementById("companies-list");
  if (!companies.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🏢</div><p>暂无客户档案</p></div>';
    return;
  }
  el.innerHTML = companies.map((c) => `
    <div class="client-item" data-id="${c.id}" data-name="${escHtml(c.name)}" data-industry="${escHtml(c.industry||'')}">
      <div class="client-avatar" style="font-size:13px;">${c.name.slice(0,2)}</div>
      <div class="client-info">
        <div class="client-name">${escHtml(c.name)}</div>
        <div class="client-company">
          ${c.primary_contact ? escHtml(c.primary_contact) + ' · ' : ''}
          ${c.contact_count ? c.contact_count + '位联系人' : '暂无联系人'}
          ${c.industry ? ' · ' + escHtml(c.industry) : ''}
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="level-badge level-${c.level}">${c.level}</span>
        <span class="list-menu-btn" data-id="${c.id}" style="font-size:20px;padding:4px 6px;color:var(--text-muted);">⋮</span>
      </div>
    </div>`).join("");

  el.querySelectorAll(".client-item").forEach((item) => {
    const id = parseInt(item.dataset.id);
    let pressTimer = null;
    item.addEventListener("touchstart", () => {
      pressTimer = setTimeout(() => showCompanyActionMenu(id, item.dataset.name, item.dataset.industry), 500);
    });
    item.addEventListener("touchend", () => clearTimeout(pressTimer));
    item.addEventListener("touchmove", () => clearTimeout(pressTimer));
    item.addEventListener("click", (e) => {
      if (e.target.classList.contains("list-menu-btn")) return;
      openCompany(id);
    });
  });

  el.querySelectorAll(".list-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = btn.closest(".client-item");
      showCompanyActionMenu(parseInt(btn.dataset.id), item.dataset.name, item.dataset.industry);
    });
  });
}

// ── Company Action Menu ───────────────────────────────────────────────────────

let _actionCompanyId = null;

function showCompanyActionMenu(id, name, industry) {
  _actionCompanyId = id;
  document.getElementById("company-action-name").textContent = name;
  document.getElementById("company-action-industry").textContent = industry || "";
  showModal("company-action-modal");
}

function actionView() {
  hideModal("company-action-modal");
  openCompany(_actionCompanyId);
}

function actionEdit() {
  hideModal("company-action-modal");
  openCompany(_actionCompanyId).then(() => editCurrentCompany());
}

function actionDelete() {
  hideModal("company-action-modal");
  const name = document.getElementById("company-action-name").textContent;
  showConfirm(`删除「${name}」及其所有联系人、记录？此操作不可撤销。`, async () => {
    await apiFetch(`/api/companies/${_actionCompanyId}`, { method: "DELETE" });
    if (currentCompanyId === _actionCompanyId) navTo("companies");
    else loadCompanies();
  });
}

// ── Company Detail ────────────────────────────────────────────────────────────

async function openCompany(id) {
  currentCompanyId = id;
  const res = await apiFetch(`/api/companies/${id}`);
  const company = await res.json();
  document.getElementById("detail-name").textContent = company.name;
  document.getElementById("detail-industry").textContent = company.industry || "";
  renderCompanyInfo(company);
  switchTab("info");
  showPage("detail");
  document.getElementById("fab").style.display = "none";
  return company;
}

function _infoField(label, val, full = false, collapse = false) {
  if (!val) return "";
  const cls = `info-item${full ? " full" : ""}`;
  if (collapse && val.length > 60) {
    const id = "f" + Math.random().toString(36).slice(2);
    return `<div class="${cls}"><div class="label">${label}</div><div class="value">
      <span id="${id}s">${escHtml(val.slice(0, 60))}…<button onclick="document.getElementById('${id}s').style.display='none';document.getElementById('${id}f').style.display=''" style="color:var(--primary);background:none;border:none;font-size:12px;cursor:pointer;">展开</button></span>
      <span id="${id}f" style="display:none;white-space:pre-wrap">${escHtml(val)}<button onclick="document.getElementById('${id}s').style.display='';document.getElementById('${id}f').style.display='none'" style="color:var(--primary);background:none;border:none;font-size:12px;cursor:pointer;"> 收起</button></span>
    </div></div>`;
  }
  return `<div class="${cls}"><div class="label">${label}</div><div class="value">${escHtml(val)}</div></div>`;
}

function renderCompanyInfo(c) {
  const F = _infoField;
  document.getElementById("company-info-grid").innerHTML = `
    <div class="info-grid">
      <div class="info-item"><div class="label">客户等级</div><div class="value"><span class="level-badge level-${c.level}">${c.level} 级</span></div></div>
      <div class="info-item"><div class="label">授信额度</div><div class="value">${c.credit_limit ? c.credit_limit + ' 万元' : '—'}</div></div>
      ${F("行业", c.industry)}
      ${F("企业规模", c.company_scale)}
      ${F("员工人数", c.employee_count)}
      ${F("办公地址", c.office_address, true)}
      ${c.notes ? `<div class="info-item full"><div class="label">备注</div><div class="value" style="white-space:pre-wrap;">${escHtml(c.notes)}</div></div>` : ''}
    </div>

    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">— 工商注册信息 —</div>
      <div class="info-grid">
        ${F("法定代表人", c.legal_rep)}
        ${F("注册资本", c.reg_capital)}
        ${F("成立日期", c.established_date)}
        ${F("社会信用代码", c.credit_code, true)}
        ${F("注册地址", c.reg_address, true)}
        ${F("主营业务", c.biz_scope, true)}
        ${F("经营范围", c.operating_scope, true, true)}
      </div>
    </div>

    <div style="margin-top:14px;">
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline btn-sm" style="flex:1;color:var(--primary);border-color:var(--primary);" onclick="autoFillCompany(this)">🔄 联网自动填充（消耗余额）</button>
        <button class="btn btn-outline btn-sm" style="flex:1;color:var(--primary);border-color:var(--primary);" onclick="openPasteExtract()">📋 粘贴内容提取</button>
      </div>
    </div>`;
}

async function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll("[id^='tab-']").forEach((t) => (t.style.display = "none"));
  document.querySelector(`.tab[onclick="switchTab('${tab}')"]`).classList.add("active");
  document.getElementById(`tab-${tab}`).style.display = tab === "equity" ? "flex" : "block";
  currentTab = tab;
  if (tab === "info") loadContacts();
  if (tab === "products") renderProducts();
  if (tab === "interactions") loadInteractions();
  if (tab === "todos") loadCompanyTodos();
  if (tab === "docs") loadDocuments();
  if (tab === "finance") loadFinancials();
  if (tab === "equity") loadEquityTab();
}

const PRODUCT_COLORS = { "资产类": "#e8f0fe", "负债类": "#e6f4ea", "中间业务": "#fff3e0" };
const PRODUCT_TEXT   = { "资产类": "#1a3a6b",  "负债类": "#276749",  "中间业务": "#744210" };

async function renderProducts() {
  const res = await apiFetch(`/api/companies/${currentCompanyId}/products`);
  const items = await res.json();
  const el = document.getElementById("products-list");
  if (!items.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📦</div><p>暂无合作台账</p><p style="font-size:13px;margin-top:8px;">点击上方「＋ 新增合作产品」添加</p></div>`;
    return;
  }
  const today = todayISO();
  const groups = { "资产类": [], "负债类": [], "中间业务": [] };
  items.forEach(p => (groups[p.category] || (groups["资产类"])).push(p));
  el.innerHTML = Object.entries(groups).map(([cat, list]) => {
    if (!list.length) return "";
    const bg = PRODUCT_COLORS[cat] || "#f0f0f0";
    const tc = PRODUCT_TEXT[cat] || "#333";
    return `<div style="margin-bottom:14px;">
      <div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px;padding:4px 8px;background:${bg};border-radius:6px;display:inline-block;">${cat}</div>
      ${list.map(p => {
        const daysLeft = p.end_date ? Math.ceil((new Date(p.end_date) - new Date(today)) / 86400000) : null;
        const expired  = daysLeft !== null && daysLeft < 0;
        const urgent   = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
        const badge    = expired ? `<span style="color:#e53e3e;font-size:11px;font-weight:700;">已到期</span>`
                       : urgent  ? `<span style="color:#e67e22;font-size:11px;font-weight:700;">${daysLeft}天后到期</span>`
                       : p.end_date ? `<span style="color:var(--text-muted);font-size:11px;">${p.end_date}到期</span>` : "";
        const isAsset = p.category === "资产类";
        const creditTypeBadge = isAsset && p.credit_type
          ? `<span style="font-size:11px;background:#e8f0fe;color:#1a3a6b;padding:1px 6px;border-radius:10px;margin-right:6px;">${escHtml(p.credit_type)}</span>`
          : "";
        const amountLine = isAsset
          ? `${p.amount ? `<span>授信 ${p.amount}万</span>` : ""}${p.loan_amount ? `<span style="margin-left:8px;">放款 ${p.loan_amount}万</span>` : ""}${p.notes ? `<span style="margin-left:8px;">${escHtml(p.notes)}</span>` : ""}`
          : `${p.amount ? `<span>${p.amount}万元</span>` : ""}${p.notes ? `<span style="margin-left:8px;">${escHtml(p.notes)}</span>` : ""}`;
        return `<div class="card" style="margin-bottom:8px;">
          <div class="card-body" style="padding:12px 14px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:15px;color:${tc};">${creditTypeBadge}${escHtml(p.product_name)}</div>
                <div style="font-size:13px;color:var(--text-muted);margin-top:3px;">
                  ${amountLine}
                  ${p.start_date ? `<span style="margin-left:8px;">${p.start_date}</span>` : ""}
                  ${badge ? `<span style="margin-left:8px;">${badge}</span>` : ""}
                </div>
              </div>
              <div style="display:flex;gap:6px;flex-shrink:0;">
                <button onclick="editProduct(${p.id})" style="background:none;border:none;color:var(--text-muted);font-size:16px;cursor:pointer;padding:2px 6px;">✏️</button>
                <button onclick="deleteProduct(${p.id})" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;padding:2px 6px;">🗑</button>
              </div>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }).join("");
}

function onProductCategoryChange() {
  const isAsset = document.getElementById("fp-category").value === "资产类";
  document.getElementById("fp-asset-section").style.display = isAsset ? "block" : "none";
  document.getElementById("fp-other-section").style.display = isAsset ? "none" : "block";
}

function showAddProduct() {
  document.getElementById("product-modal-title").textContent = "新增合作产品";
  document.getElementById("edit-product-id").value = "";
  document.getElementById("fp-category").value = "资产类";
  document.getElementById("fp-name").value = "";
  document.getElementById("fp-credit-type").value = "";
  document.getElementById("fp-amount").value = "";
  document.getElementById("fp-loan-amount").value = "";
  document.getElementById("fp-notes").value = "";
  document.getElementById("fp-amount-other").value = "";
  document.getElementById("fp-notes-other").value = "";
  document.getElementById("fp-start").value = "";
  document.getElementById("fp-end").value = "";
  onProductCategoryChange();
  showModal("product-modal");
}

async function editProduct(productId) {
  const res = await apiFetch(`/api/companies/${currentCompanyId}/products`);
  const items = await res.json();
  const p = items.find(x => x.id === productId);
  if (!p) return;
  document.getElementById("product-modal-title").textContent = "编辑合作产品";
  document.getElementById("edit-product-id").value = p.id;
  document.getElementById("fp-category").value = p.category;
  onProductCategoryChange();
  document.getElementById("fp-name").value = p.product_name;
  if (p.category === "资产类") {
    document.getElementById("fp-credit-type").value = p.credit_type || "";
    document.getElementById("fp-amount").value = p.amount || "";
    document.getElementById("fp-loan-amount").value = p.loan_amount || "";
    document.getElementById("fp-notes").value = p.notes || "";
    document.getElementById("fp-amount-other").value = "";
    document.getElementById("fp-notes-other").value = "";
  } else {
    document.getElementById("fp-amount-other").value = p.amount || "";
    document.getElementById("fp-notes-other").value = p.notes || "";
    document.getElementById("fp-credit-type").value = "";
    document.getElementById("fp-amount").value = "";
    document.getElementById("fp-loan-amount").value = "";
    document.getElementById("fp-notes").value = "";
  }
  document.getElementById("fp-start").value = p.start_date || "";
  document.getElementById("fp-end").value = p.end_date || "";
  showModal("product-modal");
}

async function saveProduct() {
  const name = document.getElementById("fp-name").value.trim();
  if (!name) { alert("请填写产品名称"); return; }
  const category = document.getElementById("fp-category").value;
  const isAsset = category === "资产类";
  const body = {
    category,
    product_name: name,
    amount: isAsset
      ? (parseFloat(document.getElementById("fp-amount").value) || 0)
      : (parseFloat(document.getElementById("fp-amount-other").value) || 0),
    credit_type: isAsset ? document.getElementById("fp-credit-type").value : "",
    loan_amount: isAsset ? (parseFloat(document.getElementById("fp-loan-amount").value) || 0) : 0,
    notes: isAsset
      ? document.getElementById("fp-notes").value.trim()
      : document.getElementById("fp-notes-other").value.trim(),
    start_date: document.getElementById("fp-start").value,
    end_date: document.getElementById("fp-end").value,
  };
  const editId = document.getElementById("edit-product-id").value;
  if (editId) {
    await apiFetch(`/api/companies/${currentCompanyId}/products/${editId}`, { method: "PUT", body: JSON.stringify(body) });
  } else {
    await apiFetch(`/api/companies/${currentCompanyId}/products`, { method: "POST", body: JSON.stringify(body) });
  }
  hideModal("product-modal");
  renderProducts();
}

async function deleteProduct(productId) {
  if (!confirm("确认删除此合作产品记录？")) return;
  await apiFetch(`/api/companies/${currentCompanyId}/products/${productId}`, { method: "DELETE" });
  renderProducts();
}

// ── Contacts ──────────────────────────────────────────────────────────────────

async function loadContacts() {
  const res = await apiFetch(`/api/companies/${currentCompanyId}/contacts`);
  currentContacts = await res.json();
  renderContactsList(currentContacts);
}

function renderContactsList(contacts) {
  const el = document.getElementById("contacts-list");
  if (!contacts.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">👤</div><p>暂无联系人</p><p style="font-size:13px;margin-top:8px;">点击上方「＋ 添加联系人」<br>录入董事长、财务总监等关键联系人</p></div>`;
    return;
  }
  el.innerHTML = contacts.map((c) => `
    <div class="card" style="margin-bottom:10px;">
      <div class="card-body" style="padding:12px 14px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-weight:600;font-size:15px;">
              ${escHtml(c.name)}
              ${c.is_primary ? '<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:10px;margin-left:6px;">主要</span>' : ''}
            </div>
            ${c.position ? `<div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${escHtml(c.position)}</div>` : ''}
          </div>
          <span style="font-size:20px;color:var(--text-muted);cursor:pointer;padding:0 4px;"
            onclick="showContactActionMenu(${c.id},'${escHtml(c.name)}','${escHtml(c.position||'')}')">⋮</span>
        </div>
        <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
          ${c.phone ? `<a href="tel:${c.phone}" style="display:flex;align-items:center;gap:4px;font-size:13px;color:var(--primary);text-decoration:none;">📱 ${escHtml(c.phone)}</a>` : ''}
          ${c.wechat ? `<span style="font-size:13px;color:var(--text-muted);">💬 ${escHtml(c.wechat)}</span>` : ''}
        </div>
        ${c.notes ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">${escHtml(c.notes)}</div>` : ''}
      </div>
    </div>`).join("");
}

function showAddContact() {
  document.getElementById("contact-modal-title").textContent = "添加联系人";
  document.getElementById("edit-contact-id").value = "";
  ["ft-name","ft-position","ft-phone","ft-wechat","ft-notes"].forEach((id) => document.getElementById(id).value = "");
  document.getElementById("ft-primary").checked = false;
  showModal("add-contact-modal");
}

async function saveContact() {
  const editId = document.getElementById("edit-contact-id").value;
  const body = {
    company_id: currentCompanyId,
    name: document.getElementById("ft-name").value.trim(),
    position: document.getElementById("ft-position").value.trim(),
    phone: document.getElementById("ft-phone").value.trim(),
    wechat: document.getElementById("ft-wechat").value.trim(),
    email: "",
    is_primary: document.getElementById("ft-primary").checked,
    notes: document.getElementById("ft-notes").value.trim(),
  };
  if (!body.name) { alert("姓名不能为空"); return; }
  if (editId) {
    await apiFetch(`/api/contacts/${editId}`, { method: "PUT", body: JSON.stringify(body) });
  } else {
    await apiFetch("/api/contacts", { method: "POST", body: JSON.stringify(body) });
  }
  hideModal("add-contact-modal");
  loadContacts();
}

let _actionContactId = null;

function showContactActionMenu(id, name, position) {
  _actionContactId = id;
  document.getElementById("contact-action-name").textContent = name;
  document.getElementById("contact-action-pos").textContent = position;
  showModal("contact-action-modal");
}

function contactActionEdit() {
  hideModal("contact-action-modal");
  const c = currentContacts.find((c) => c.id === _actionContactId);
  if (!c) return;
  document.getElementById("contact-modal-title").textContent = "编辑联系人";
  document.getElementById("edit-contact-id").value = c.id;
  document.getElementById("ft-name").value = c.name;
  document.getElementById("ft-position").value = c.position || "";
  document.getElementById("ft-phone").value = c.phone || "";
  document.getElementById("ft-wechat").value = c.wechat || "";
  document.getElementById("ft-notes").value = c.notes || "";
  document.getElementById("ft-primary").checked = !!c.is_primary;
  showModal("add-contact-modal");
}

function contactActionDelete() {
  hideModal("contact-action-modal");
  const name = document.getElementById("contact-action-name").textContent;
  showConfirm(`删除联系人「${name}」？`, async () => {
    await apiFetch(`/api/contacts/${_actionContactId}`, { method: "DELETE" });
    loadContacts();
  });
}

// ── Interactions ──────────────────────────────────────────────────────────────

async function loadInteractions() {
  const res = await apiFetch(`/api/companies/${currentCompanyId}/interactions`);
  const items = await res.json();
  const el = document.getElementById("interactions-list");
  if (!items.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📝</div><p>暂无互动记录</p></div>';
    return;
  }
  el.innerHTML = items.map((i) => `
    <div class="interaction-item">
      <div class="interaction-header">
        <span class="interaction-date">${i.date}</span>
        <span class="interaction-type">${i.type}</span>
        ${i.contact_name ? `<span style="font-size:12px;color:var(--text-muted);">${escHtml(i.contact_name)}</span>` : ''}
        <span style="margin-left:auto;font-size:18px;cursor:pointer;color:var(--text-muted);"
          onclick="deleteInteraction(${i.id})">🗑</span>
      </div>
      <div class="interaction-content">${escHtml(i.content)}</div>
      ${i.next_action ? `<div class="interaction-next">→ ${escHtml(i.next_action)}</div>` : ''}
    </div>`).join("");
}

function deleteInteraction(id) {
  showConfirm("确认删除此互动记录？", async () => {
    await apiFetch(`/api/interactions/${id}`, { method: "DELETE" });
    loadInteractions();
  });
}

async function saveInteraction() {
  const contactVal = document.getElementById("i-contact").value;
  const body = {
    company_id: currentCompanyId,
    contact_id: contactVal ? parseInt(contactVal) : null,
    date: document.getElementById("i-date").value,
    type: document.getElementById("i-type").value,
    content: document.getElementById("i-content").value.trim(),
    next_action: document.getElementById("i-next").value.trim(),
  };
  if (!body.date || !body.content) { alert("日期和内容不能为空"); return; }
  await apiFetch("/api/interactions", { method: "POST", body: JSON.stringify(body) });
  hideModal("add-interaction-modal");
  document.getElementById("i-content").value = "";
  document.getElementById("i-next").value = "";
  loadInteractions();
}

// ── Todos ─────────────────────────────────────────────────────────────────────

async function loadCompanyTodos() {
  const res = await apiFetch(`/api/todos?company_id=${currentCompanyId}`);
  const todos = await res.json();
  const el = document.getElementById("company-todos-list");
  if (!todos.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><p>暂无待办</p></div>';
    return;
  }
  el.innerHTML = todos.map((t) => renderTodoItem(t, "company")).join("");
}

function showAddTodo(forCompany = false) {
  document.getElementById("todo-modal-title").textContent = "添加待办";
  document.getElementById("edit-todo-id").value = "";
  document.getElementById("t-date").value = todayISO();
  document.getElementById("t-end-date").value = "";
  document.getElementById("t-content").value = "";
  document.getElementById("t-priority").value = "medium";
  document.getElementById("todo-company-id").value = forCompany && currentCompanyId ? currentCompanyId : "";
  document.getElementById("sub-items-editor").innerHTML = "";
  showModal("add-todo-modal");
}

function addSubItemInput(text = "") {
  const editor = document.getElementById("sub-items-editor");
  const div = document.createElement("div");
  div.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
  div.innerHTML = `<input type="text" class="form-input" style="flex:1;" placeholder="子项内容" value="${escHtml(text)}">
    <button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;flex-shrink:0;">×</button>`;
  editor.appendChild(div);
  div.querySelector("input").focus();
}

function getSubItemsFromEditor() {
  return Array.from(document.querySelectorAll("#sub-items-editor input"))
    .map(i => ({ content: i.value.trim(), done: false }))
    .filter(i => i.content);
}

async function saveTodo() {
  const editId = document.getElementById("edit-todo-id").value;
  const cid = document.getElementById("todo-company-id").value;
  const body = {
    company_id: cid ? parseInt(cid) : null,
    date: document.getElementById("t-date").value,
    end_date: document.getElementById("t-end-date").value,
    content: document.getElementById("t-content").value.trim(),
    priority: document.getElementById("t-priority").value,
    sub_items: getSubItemsFromEditor(),
  };
  if (!body.date || !body.content) { alert("内容和日期不能为空"); return; }
  if (editId) {
    await apiFetch(`/api/todos/${editId}`, { method: "PUT", body: JSON.stringify(body) });
  } else {
    await apiFetch("/api/todos", { method: "POST", body: JSON.stringify(body) });
  }
  hideModal("add-todo-modal");
  if (currentPage === "today") loadToday();
  if (currentTab === "todos") loadCompanyTodos();
}

async function editTodo(id, fromPage) {
  const res = await apiFetch("/api/todos?company_id=" + (currentCompanyId || ""));
  const all = await res.json();
  const t = all.find(x => x.id === id) || (await apiFetch(`/api/todos`).then(r=>r.json()).then(a=>a.find(x=>x.id===id)));
  if (!t) return;
  document.getElementById("todo-modal-title").textContent = "编辑待办";
  document.getElementById("edit-todo-id").value = t.id;
  document.getElementById("t-date").value = t.date;
  document.getElementById("t-end-date").value = t.end_date || "";
  document.getElementById("t-content").value = t.content;
  document.getElementById("t-priority").value = t.priority;
  document.getElementById("todo-company-id").value = t.company_id || "";
  const editor = document.getElementById("sub-items-editor");
  editor.innerHTML = "";
  const subs = typeof t.sub_items === "string" ? JSON.parse(t.sub_items || "[]") : (t.sub_items || []);
  subs.forEach(s => addSubItemInputWithDone(s.content, s.done));
  showModal("add-todo-modal");
}

function addSubItemInputWithDone(text = "", done = false) {
  const editor = document.getElementById("sub-items-editor");
  const div = document.createElement("div");
  div.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:6px;";
  div.innerHTML = `<input type="text" class="form-input" style="flex:1;${done ? 'text-decoration:line-through;color:var(--text-muted);' : ''}" placeholder="子项内容" value="${escHtml(text)}" data-done="${done}">
    <button type="button" onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;flex-shrink:0;">×</button>`;
  editor.appendChild(div);
}

function getSubItemsFromEditor() {
  return Array.from(document.querySelectorAll("#sub-items-editor input[type=text]"))
    .map(i => ({ content: i.value.trim(), done: i.dataset.done === "true" }))
    .filter(i => i.content);
}

function toggleTodo(id, fromPage) {
  apiFetch(`/api/todos/${id}/toggle`, { method: "PATCH" }).then(() => {
    if (fromPage === "today") loadToday();
    if (fromPage === "company") loadCompanyTodos();
  });
}

function deleteTodo(id, fromPage) {
  showConfirm("确认删除此待办？", async () => {
    await apiFetch(`/api/todos/${id}`, { method: "DELETE" });
    if (fromPage === "today") loadToday();
    if (fromPage === "company") loadCompanyTodos();
  });
}

function renderTodoItem(t, fromPage) {
  const today = todayISO();
  let dateBadge;
  if (t.end_date) {
    const cls = t.end_date < today ? "past" : t.date <= today ? "today" : "future";
    const prefix = t.end_date < today ? "已结束 " : "";
    dateBadge = `<span class="todo-date-badge ${cls}">${prefix}${t.date} ~ ${t.end_date}</span>`;
  } else {
    dateBadge = t.date < today
      ? `<span class="todo-date-badge past">逾期 ${t.date}</span>`
      : t.date === today
      ? `<span class="todo-date-badge today">今天</span>`
      : `<span class="todo-date-badge future">${t.date}</span>`;
  }
  const who = t.company_name ? `<span style="color:var(--primary)">${escHtml(t.company_name)}</span> · ` : "";
  const subs = typeof t.sub_items === "string" ? JSON.parse(t.sub_items || "[]") : (t.sub_items || []);
  const subHtml = subs.length ? `
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);">
      ${subs.map((s, i) => `
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
          <div onclick="toggleSubItem(${t.id},${i},'${fromPage}')"
            style="width:16px;height:16px;border-radius:3px;border:1.5px solid ${s.done ? 'var(--success)' : 'var(--border)'};
                   background:${s.done ? 'var(--success)' : '#fff'};cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            ${s.done ? '<span style="color:#fff;font-size:10px;font-weight:700;">✓</span>' : ''}
          </div>
          <span style="font-size:13px;${s.done ? 'text-decoration:line-through;color:var(--text-muted);' : ''}">${escHtml(s.content)}</span>
        </div>`).join("")}
    </div>` : "";
  return `
  <div class="todo-item priority-${t.priority}">
    <div class="todo-check ${t.done ? 'done' : ''}" onclick="toggleTodo(${t.id},'${fromPage}')">
      ${t.done ? "✓" : ""}
    </div>
    <div class="todo-content" style="flex:1;min-width:0;">
      <div class="todo-text ${t.done ? 'done' : ''}">${escHtml(t.content)}</div>
      <div class="todo-meta">${who}${dateBadge}</div>
      ${subHtml}
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;align-items:center;">
      <span onclick="editTodo(${t.id},'${fromPage}')" style="cursor:pointer;font-size:15px;padding:2px 4px;">✏️</span>
      <span onclick="showTodoDocs(${t.id},'${escHtml(t.content)}')" style="cursor:pointer;font-size:15px;padding:2px 4px;position:relative;">📎${t.doc_count ? `<span style="position:absolute;top:-2px;right:-2px;background:var(--primary);color:#fff;font-size:9px;font-weight:700;border-radius:8px;padding:1px 4px;line-height:1.2;">${t.doc_count}</span>` : ''}</span>
      <span class="todo-delete" onclick="deleteTodo(${t.id},'${fromPage}')">×</span>
    </div>
  </div>`;
}

async function toggleSubItem(todoId, idx, fromPage) {
  const res = await apiFetch("/api/todos");
  const all = await res.json();
  const t = all.find(x => x.id === todoId);
  if (!t) return;
  const subs = typeof t.sub_items === "string" ? JSON.parse(t.sub_items || "[]") : (t.sub_items || []);
  subs[idx].done = !subs[idx].done;
  await apiFetch(`/api/todos/${todoId}/sub_items`, { method: "PATCH", body: JSON.stringify({ sub_items: subs }) });
  if (fromPage === "today") loadToday();
  if (fromPage === "company") loadCompanyTodos();
}

// ── Company CRUD ──────────────────────────────────────────────────────────────

function showQuickAdd() {
  showModal("add-company-modal");
}

function editCurrentCompany() {
  apiFetch(`/api/companies/${currentCompanyId}`).then((r) => r.json()).then((c) => {
    document.getElementById("company-modal-title").textContent = "编辑企业";
    document.getElementById("edit-company-id").value = c.id;
    document.getElementById("fc-name").value = c.name;
    document.getElementById("fc-industry").value = c.industry || "";
    document.getElementById("fc-level").value = c.level;
    document.getElementById("fc-credit").value = c.credit_limit || "";
    document.getElementById("fc-notes").value = c.notes || "";
    document.getElementById("fc-legal-rep").value = c.legal_rep || "";
    document.getElementById("fc-legal-rep-id").value = c.legal_rep_id || "";
    document.getElementById("fc-credit-code").value = c.credit_code || "";
    document.getElementById("fc-reg-capital").value = c.reg_capital || "";
    document.getElementById("fc-established-date").value = c.established_date || "";
    document.getElementById("fc-reg-address").value = c.reg_address || "";
    document.getElementById("fc-biz-scope").value = c.biz_scope || "";
    document.getElementById("fc-operating-scope").value = c.operating_scope || "";
    document.getElementById("fc-company-scale").value = c.company_scale || "";
    document.getElementById("fc-office-address").value = c.office_address || "";
    document.getElementById("fc-employee-count").value = c.employee_count || "";
    showModal("add-company-modal");
  });
}

async function saveCompany() {
  const editId = document.getElementById("edit-company-id").value;
  const body = {
    name: document.getElementById("fc-name").value.trim(),
    industry: document.getElementById("fc-industry").value.trim(),
    level: document.getElementById("fc-level").value,
    credit_limit: parseFloat(document.getElementById("fc-credit").value) || 0,
    products: [],
    tags: [],
    notes: document.getElementById("fc-notes").value.trim(),
    legal_rep: document.getElementById("fc-legal-rep").value.trim(),
    legal_rep_id: document.getElementById("fc-legal-rep-id").value.trim(),
    credit_code: document.getElementById("fc-credit-code").value.trim(),
    reg_capital: document.getElementById("fc-reg-capital").value.trim(),
    established_date: document.getElementById("fc-established-date").value.trim(),
    reg_address: document.getElementById("fc-reg-address").value.trim(),
    biz_scope: document.getElementById("fc-biz-scope").value.trim(),
    company_scale: document.getElementById("fc-company-scale").value,
    office_address: document.getElementById("fc-office-address").value.trim(),
    employee_count: document.getElementById("fc-employee-count").value.trim(),
    operating_scope: document.getElementById("fc-operating-scope").value.trim(),
  };
  if (!body.name) { alert("企业名称不能为空"); return; }
  if (editId) {
    await apiFetch(`/api/companies/${editId}`, { method: "PUT", body: JSON.stringify(body) });
    hideModal("add-company-modal");
    document.getElementById("edit-company-id").value = "";
    openCompany(parseInt(editId));
  } else {
    const res = await apiFetch("/api/companies", { method: "POST", body: JSON.stringify(body) });
    const newCompany = await res.json();
    hideModal("add-company-modal");
    clearCompanyForm();
    loadCompanies();
    openCompany(newCompany.id);
  }
}

function clearCompanyForm() {
  ["fc-name","fc-industry","fc-credit","fc-notes",
   "fc-legal-rep","fc-legal-rep-id","fc-credit-code","fc-reg-capital",
   "fc-established-date","fc-reg-address","fc-biz-scope",
   "fc-office-address","fc-employee-count","fc-operating-scope"
  ].forEach((id) => document.getElementById(id).value = "");
  document.getElementById("fc-company-scale").value = "";
  document.getElementById("fc-level").value = "B";
  document.getElementById("company-modal-title").textContent = "新建企业";
  document.getElementById("edit-company-id").value = "";
}

let _autofillFields = {};

const _AUTOFILL_LABELS = {
  legal_rep: "法定代表人", credit_code: "统一社会信用代码",
  reg_capital: "注册资本", established_date: "成立日期",
  reg_address: "注册地址", biz_scope: "主营业务", industry: "所属行业",
  company_scale: "企业规模", office_address: "办公地址", employee_count: "员工人数",
  operating_scope: "经营范围",
};

async function autoFillCompany(btn) {
  const orig = btn.textContent;
  btn.textContent = "联网查询中，请稍候（约20秒）…";
  btn.disabled = true;
  try {
    const res = await apiFetch(`/api/ai/company-autofill/${currentCompanyId}`);
    const data = await res.json();
    const filled = Object.entries(data.fields || {}).filter(([, v]) => v);
    if (!filled.length) {
      alert("未能查询到公开工商信息，可能该企业规模较小，请手动填写。");
      return;
    }
    _autofillFields = data.fields;
    document.getElementById("autofill-preview").innerHTML = filled.map(([k, v]) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start;">
        <div style="width:90px;flex-shrink:0;font-size:12px;color:var(--text-muted);padding-top:2px;">${_AUTOFILL_LABELS[k] || k}</div>
        <div style="font-size:14px;word-break:break-all;">${escHtml(v)}</div>
      </div>`).join("");
    showModal("autofill-modal");
  } catch (e) {
    alert("查询失败：" + e.message);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

function openPasteExtract() {
  document.getElementById("paste-extract-text").value = "";
  showModal("paste-extract-modal");
}

async function extractFromPaste(btn) {
  const text = document.getElementById("paste-extract-text").value.trim();
  if (!text) { alert("请先粘贴企业信息文本"); return; }
  const orig = btn.textContent;
  btn.textContent = "识别中…";
  btn.disabled = true;
  try {
    const res = await apiFetch("/api/ai/extract-fields", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    const filled = Object.entries(data.fields || {}).filter(([, v]) => v);
    if (!filled.length) { alert("未能识别到有效字段，请检查粘贴内容。"); return; }
    _autofillFields = data.fields;
    document.getElementById("autofill-preview").innerHTML = filled.map(([k, v]) => `
      <div style="padding:10px 0;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start;">
        <div style="width:90px;flex-shrink:0;font-size:12px;color:var(--text-muted);padding-top:2px;">${_AUTOFILL_LABELS[k] || k}</div>
        <div style="font-size:14px;word-break:break-all;">${escHtml(v)}</div>
      </div>`).join("");
    hideModal("paste-extract-modal");
    showModal("autofill-modal");
  } catch (e) {
    alert("提取失败：" + e.message);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

async function confirmAutofill() {
  const res = await apiFetch(`/api/companies/${currentCompanyId}`);
  const c = await res.json();
  const f = _autofillFields;
  const body = {
    name: c.name, industry: f.industry || c.industry || "",
    level: c.level, credit_limit: c.credit_limit,
    products: c.products || [], tags: c.tags || [], notes: c.notes || "",
    legal_rep: f.legal_rep || c.legal_rep || "",
    legal_rep_id: c.legal_rep_id || "",
    credit_code: f.credit_code || c.credit_code || "",
    reg_capital: f.reg_capital || c.reg_capital || "",
    established_date: f.established_date || c.established_date || "",
    reg_address: f.reg_address || c.reg_address || "",
    biz_scope: f.biz_scope || c.biz_scope || "",
    company_scale: f.company_scale || c.company_scale || "",
    office_address: f.office_address || c.office_address || "",
    employee_count: f.employee_count || c.employee_count || "",
    operating_scope: f.operating_scope || c.operating_scope || "",
  };
  await apiFetch(`/api/companies/${currentCompanyId}`, { method: "PUT", body: JSON.stringify(body) });
  hideModal("autofill-modal");
  openCompany(currentCompanyId);
}

function deleteCurrentCompany() {
  const name = document.getElementById("detail-name").textContent;
  showConfirm(`删除「${name}」及其所有联系人、记录？此操作不可撤销。`, async () => {
    await apiFetch(`/api/companies/${currentCompanyId}`, { method: "DELETE" });
    navTo("companies");
  });
}

// ── AI ────────────────────────────────────────────────────────────────────────

let aiSelectedCompanyId = null;
let aiTab = "single";
let searchHistory = [];

function setAiTab(tab) {
  aiTab = tab;
  const isSingle = tab === "single";
  const tabSingle = document.getElementById("ai-tab-single");
  const tabSearch = document.getElementById("ai-tab-search");
  tabSingle.style.borderBottomColor = isSingle ? "var(--primary)" : "transparent";
  tabSingle.style.color = isSingle ? "var(--primary)" : "var(--text-muted)";
  tabSingle.style.fontWeight = isSingle ? "600" : "normal";
  tabSearch.style.borderBottomColor = isSingle ? "transparent" : "var(--primary)";
  tabSearch.style.color = isSingle ? "var(--text-muted)" : "var(--primary)";
  tabSearch.style.fontWeight = isSingle ? "normal" : "600";
  document.getElementById("ai-company-bar").style.display = isSingle ? "flex" : "none";
  document.getElementById("ai-search-bar").style.display = isSingle ? "none" : "block";
  document.getElementById("ai-mode").style.display = isSingle ? "" : "none";
  const chatEl = document.getElementById("chat-messages");
  chatEl.innerHTML = isSingle ? "" : `<div style="text-align:center;padding:32px 16px;color:var(--text-muted);font-size:14px;line-height:1.8;">🔍 全库检索模式<br><span style="font-size:12px;">基于所有客户档案，用云端AI回答你的问题</span></div>`;
  searchHistory = [];
  chatHistory = [];
  document.getElementById("chat-input").placeholder = isSingle
    ? "问任何客户相关的问题..."
    : "检索客户信息，例如：哪些A级客户近期没有跟进？";
}

function quickSearch(q) {
  document.getElementById("chat-input").value = q;
  sendChat();
}

async function loadAiCompanySelector() {
  const res = await apiFetch("/api/companies");
  const companies = await res.json();
  const sel = document.getElementById("ai-company-select");
  const current = sel.value;
  sel.innerHTML = '<option value="">不关联（通用对话）</option>' +
    companies.map((c) => `<option value="${c.id}">${escHtml(c.name)}</option>`).join("");
  if (current) sel.value = current;
}

function onAiCompanyChange() {
  const sel = document.getElementById("ai-company-select");
  const id = parseInt(sel.value) || null;
  const btn = document.getElementById("ai-clear-btn");
  if (id !== aiSelectedCompanyId) {
    aiSelectedCompanyId = id;
    chatHistory = [];
    const el = document.getElementById("chat-messages");
    el.innerHTML = "";
    if (id) {
      const name = sel.options[sel.selectedIndex].text;
      el.innerHTML = `<div style="text-align:center;padding:16px 0;">
        <div style="display:inline-block;background:#f0f4ff;border:1px solid #c7d7f9;border-radius:20px;padding:6px 16px;font-size:13px;color:var(--primary);">
          📂 已加载「${escHtml(name)}」的客户档案
        </div>
      </div>`;
    }
  }
  btn.style.display = id ? "block" : "none";
}

function clearAiCompany() {
  document.getElementById("ai-company-select").value = "";
  onAiCompanyChange();
}

async function sendChat() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  input.style.height = "auto";
  appendChatBubble(msg, "user");
  const loadingId = appendChatBubble("…", "ai");

  let res;
  if (aiTab === "search") {
    searchHistory.push({ role: "user", content: msg });
    res = await apiFetch("/api/ai/search", {
      method: "POST",
      body: JSON.stringify({ message: msg, history: searchHistory.slice(-6) }),
    });
    const data = await res.json();
    updateChatBubble(loadingId, data.reply);
    searchHistory.push({ role: "assistant", content: data.reply });
  } else {
    const mode = document.getElementById("ai-mode").value;
    chatHistory.push({ role: "user", content: msg });
    res = await apiFetch("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message: msg, company_id: aiSelectedCompanyId, mode, history: chatHistory.slice(-10) }),
    });
    const data = await res.json();
    updateChatBubble(loadingId, data.reply);
    chatHistory.push({ role: "assistant", content: data.reply });
  }
  const msgEl = document.getElementById("chat-messages");
  msgEl.scrollTop = msgEl.scrollHeight;
}

function appendChatBubble(text, role) {
  const id = "bubble-" + Date.now();
  const el = document.getElementById("chat-messages");
  el.innerHTML += `<div id="${id}" class="chat-bubble chat-${role}">${escHtml(text)}</div>`;
  el.scrollTop = 999999;
  return id;
}

function updateChatBubble(id, text) {
  const el = document.getElementById(id);
  if (el) el.style.whiteSpace = "pre-wrap", el.textContent = text;
}

async function quickAnalysis(prompt, mode = "fast") {
  const resultEl = document.getElementById("detail-ai-result");
  const contentEl = document.getElementById("detail-ai-content");
  resultEl.style.display = "block";
  contentEl.textContent = "分析中…";
  const res = await apiFetch("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message: prompt, company_id: currentCompanyId, mode }),
  });
  const data = await res.json();
  contentEl.textContent = data.reply;
}

async function researchCompany() {
  const resultEl = document.getElementById("detail-ai-result");
  const contentEl = document.getElementById("detail-ai-content");
  resultEl.style.display = "block";
  contentEl.textContent = "正在调用云端AI查询企业公开信息，请稍候（约15-30秒）…";
  try {
    const res = await apiFetch(`/api/ai/company-research/${currentCompanyId}`);
    const data = await res.json();
    contentEl.textContent = data.reply;
  } catch (e) {
    contentEl.textContent = "查询失败：" + e.message;
  }
}

// ── PDF Import ────────────────────────────────────────────────────────────────

let pdfParsedCompanies = [];

function triggerPdfUpload() {
  document.getElementById("pdf-file-input").value = "";
  document.getElementById("pdf-file-input").click();
}

async function handlePdfUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const listEl = document.getElementById("pdf-preview-list");
  const summaryEl = document.getElementById("pdf-preview-summary");
  listEl.innerHTML = '<div class="loading"><div class="spinner"></div> AI 解析中，请稍候…</div>';
  summaryEl.textContent = "";
  showModal("pdf-preview-modal");
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`${API}/api/import/pdf/preview`, {
      method: "POST", headers: { "X-Access-Token": token }, body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "解析失败");
    pdfParsedCompanies = data.companies;
    summaryEl.textContent = `共识别到 ${data.total} 家企业，请确认后导入`;
    renderPdfPreview(data.companies);
  } catch (e) {
    listEl.innerHTML = `<div style="color:var(--danger);padding:12px">${e.message}</div>`;
  }
}

function renderPdfPreview(companies) {
  const el = document.getElementById("pdf-preview-list");
  if (!companies.length) {
    el.innerHTML = '<div class="empty"><p>未识别到企业信息</p></div>';
    return;
  }
  el.innerHTML = companies.map((c, i) => `
    <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <input type="checkbox" id="pdf-chk-${i}" checked style="margin-top:4px;width:18px;height:18px;flex-shrink:0;">
      <label for="pdf-chk-${i}" style="flex:1;cursor:pointer;">
        <div style="font-weight:600;font-size:14px;">${escHtml(c.name)} <span class="level-badge level-${c.level||'B'}">${c.level||'B'}</span></div>
        ${c.industry ? `<div style="font-size:12px;color:var(--text-muted);">${escHtml(c.industry)}</div>` : ''}
        ${(c.contacts||[]).map((ct) => `<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">👤 ${escHtml(ct.name)}${ct.position?' · '+escHtml(ct.position):''}${ct.phone?' 📱'+escHtml(ct.phone):''}</div>`).join('')}
      </label>
    </div>`).join("");
}

async function confirmPdfImport() {
  const selected = pdfParsedCompanies.filter((_, i) => document.getElementById(`pdf-chk-${i}`)?.checked);
  if (!selected.length) { alert("请至少选择一家企业"); return; }
  const btn = document.getElementById("pdf-confirm-btn");
  btn.textContent = "导入中…";
  btn.disabled = true;
  const res = await apiFetch("/api/import/pdf/confirm", {
    method: "POST", body: JSON.stringify({ companies: selected }),
  });
  const data = await res.json();
  btn.textContent = "确认导入";
  btn.disabled = false;
  hideModal("pdf-preview-modal");
  alert(`✅ 成功导入 ${data.imported} 家企业${data.skipped ? `，${data.skipped} 条已跳过` : ''}`);
  loadCompanies();
}

// ── Interaction modal helpers ─────────────────────────────────────────────────

function populateContactSelect() {
  const sel = document.getElementById("i-contact");
  sel.innerHTML = '<option value="">不指定</option>' +
    currentContacts.map((c) => `<option value="${c.id}">${escHtml(c.name)}${c.position ? ' · ' + c.position : ''}</option>`).join("");
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

let _confirmCallback = null;

function showConfirm(message, onOk) {
  document.getElementById("confirm-message").textContent = message;
  _confirmCallback = onOk;
  showModal("confirm-modal");
}

function confirmOk() {
  hideModal("confirm-modal");
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
}

function showModal(id) {
  document.getElementById(id).classList.add("open");
  if (id === "add-interaction-modal") {
    document.getElementById("i-date").value = todayISO();
    populateContactSelect();
  }
}

function hideModal(id) {
  document.getElementById(id).classList.remove("open");
}

document.addEventListener("click", (e) => {
  if (e.target.classList.contains("modal-overlay")) e.target.classList.remove("open");
});

// ── Utils ─────────────────────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().slice(0, 10); }

function escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Documents ─────────────────────────────────────────────────────────────────

const DOC_CATEGORIES = ["基本信息", "财务状况", "授信批复", "合同协议", "抵押担保", "贷后管理", "其他"];
const CAT_COLORS = {
  "基本信息": "#3b82f6", "财务状况": "#10b981", "授信批复": "#f59e0b",
  "合同协议": "#8b5cf6", "抵押担保": "#ef4444", "贷后管理": "#06b6d4", "其他": "#6b7280",
};
let docFilterCategory = "全部";
let docUploadCategory = "其他";
let _cachedDocs = [];

function openUploadDocModal() {
  docUploadCategory = "其他";
  const btns = document.getElementById("doc-category-btns");
  btns.innerHTML = DOC_CATEGORIES.map(c => `
    <button id="doc-cat-btn-${c}" onclick="selectDocCategory('${c}')"
      style="padding:6px 14px;border-radius:20px;border:2px solid ${c === docUploadCategory ? 'var(--primary)' : 'var(--border)'};background:${c === docUploadCategory ? 'var(--primary)' : 'transparent'};color:${c === docUploadCategory ? '#fff' : 'var(--text)'};font-size:13px;cursor:pointer;">${c}</button>
  `).join("");
  showModal("upload-doc-modal");
}

function selectDocCategory(cat) {
  docUploadCategory = cat;
  DOC_CATEGORIES.forEach(c => {
    const btn = document.getElementById(`doc-cat-btn-${c}`);
    if (!btn) return;
    const active = c === cat;
    btn.style.background = active ? "var(--primary)" : "transparent";
    btn.style.color = active ? "#fff" : "var(--text)";
    btn.style.borderColor = active ? "var(--primary)" : "var(--border)";
  });
}

function _renderDocList(allDocs) {
  const filterBar = document.getElementById("doc-filter-bar");
  if (filterBar) {
    filterBar.innerHTML = ["全部", ...DOC_CATEGORIES].map(c => {
      const active = docFilterCategory === c;
      return `<button onclick="setDocFilter('${c}')"
        style="padding:5px 12px;border-radius:20px;border:1px solid ${active ? 'var(--primary)' : 'var(--border)'};background:${active ? 'var(--primary)' : 'transparent'};color:${active ? '#fff' : 'var(--text-muted)'};font-size:12px;cursor:pointer;white-space:nowrap;">${c}</button>`;
    }).join("");
  }
  const docs = docFilterCategory === "全部" ? allDocs : allDocs.filter(d => (d.category || "其他") === docFilterCategory);
  const el = document.getElementById("docs-list");
  if (!el) return;
  if (!docs.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">📄</div><p>暂无文档</p></div>`;
    return;
  }
  el.innerHTML = docs.map((d) => {
    const color = CAT_COLORS[d.category] || "#6b7280";
    let indexBadge = "";
    if (d.doc_indexed === 0) {
      indexBadge = `<span class="doc-index-badge indexing"><span class="doc-index-spin"></span>索引中</span>`;
    } else if (d.doc_indexed === 1 && d.doc_text) {
      indexBadge = `<span class="doc-index-badge indexed">✓ 可检索</span>`;
    }
    return `
    <div class="card" style="margin-bottom:10px;">
      <div class="card-body" style="padding:12px 14px;display:flex;align-items:center;gap:12px;">
        <div style="font-size:28px;">${docIcon(d.original_name)}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(d.original_name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${formatSize(d.size)} · ${d.uploaded_at.slice(0,10)}</div>
          <span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:10px;font-size:11px;color:#fff;background:${color};">${d.category || "其他"}</span>${indexBadge}
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <a href="/api/documents/${d.id}/download" target="_blank"
             style="font-size:13px;color:var(--primary);text-decoration:none;padding:6px 10px;border:1px solid var(--border);border-radius:6px;">查看</a>
          <button onclick="deleteDocument(${d.id})"
            style="font-size:13px;color:var(--danger);background:none;border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;">删除</button>
        </div>
      </div>
    </div>`;
  }).join("");
}

async function loadDocuments() {
  const res = await apiFetch(`/api/companies/${currentCompanyId}/documents`);
  _cachedDocs = await res.json();
  _renderDocList(_cachedDocs);
  if (_cachedDocs.some(d => d.doc_indexed === 0)) _startIndexPoll();
}

function setDocFilter(cat) {
  docFilterCategory = cat;
  loadDocuments();
}

const DOC_ICONS = {
  pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊",
  ppt: "📋", pptx: "📋", txt: "📃", csv: "📃", md: "📃",
};

function docIcon(filename) {
  const ext = filename.split(".").pop().toLowerCase();
  return DOC_ICONS[ext] || "📎";
}

function _xhrUpload(url, formData, headers) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.addEventListener("load", () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.detail || `上传失败 ${xhr.status}`));
    });
    xhr.addEventListener("error", () => reject(new Error("网络错误，请检查连接")));
    xhr.send(formData);
  });
}

function _btnSpin(btn, label) {
  btn.disabled = true;
  btn.innerHTML = `<span class="upload-spin"></span>${label}`;
}
function _btnReset(btn, label) {
  btn.disabled = false;
  btn.textContent = label;
}

let _indexPollTimer = null;
function _startIndexPoll() {
  if (_indexPollTimer) return;
  let ticks = 0;
  _indexPollTimer = setInterval(async () => {
    ticks++;
    if (ticks > 40) { clearInterval(_indexPollTimer); _indexPollTimer = null; return; }
    const res = await apiFetch(`/api/companies/${currentCompanyId}/documents`).catch(() => null);
    if (!res) return;
    const docs = await res.json();
    const anyPending = docs.some(d => d.doc_indexed === 0);
    _renderDocList(docs);
    if (!anyPending) { clearInterval(_indexPollTimer); _indexPollTimer = null; }
  }, 3000);
}

async function handleDocUpload(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = "";
  const btn = document.getElementById("doc-upload-btn");
  const cancelBtn = document.getElementById("doc-upload-cancel-btn");
  _btnSpin(btn, `上传中…`);
  cancelBtn.disabled = true;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", docUploadCategory);
  try {
    const newDoc = await _xhrUpload(
      `${API}/api/companies/${currentCompanyId}/documents`,
      formData,
      { "X-Access-Token": token }
    );
    hideModal("upload-doc-modal");
    // 立即将新文件插入列表顶部
    _cachedDocs = [newDoc, ..._cachedDocs];
    _renderDocList(_cachedDocs);
    _startIndexPoll();
  } catch (e) {
    alert("上传失败：" + e.message);
  } finally {
    _btnReset(btn, "选择文件并上传");
    cancelBtn.disabled = false;
  }
}

function deleteDocument(id) {
  showConfirm("确认删除此文档？", async () => {
    await apiFetch(`/api/documents/${id}`, { method: "DELETE" });
    loadDocuments();
  });
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

// ── Push Notifications ────────────────────────────────────────────────────────

function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function showPushModal() {
  await refreshPushStatus();
  showModal("push-modal");
}

async function refreshPushStatus() {
  const statusEl = document.getElementById("push-status");
  const btn = document.getElementById("push-toggle-btn");
  btn.disabled = false;
  try {
    const res = await apiFetch("/api/push/vapid-key");
    const { enabled } = await res.json();
    if (enabled) {
      statusEl.innerHTML = "✅ 推送已开启，每天 08:00 自动提醒";
      statusEl.style.color = "var(--success)";
      btn.textContent = "关闭推送"; btn.className = "btn btn-outline";
    } else {
      statusEl.innerHTML = "🔕 推送未开启";
      statusEl.style.color = "var(--text-muted)";
      btn.textContent = "开启推送"; btn.className = "btn btn-primary";
    }
  } catch(e) {
    statusEl.innerHTML = "⚠️ 无法获取推送状态";
    btn.textContent = "开启推送"; btn.className = "btn btn-primary";
  }
}

async function togglePush() {
  const btn = document.getElementById("push-toggle-btn");
  const res = await apiFetch("/api/push/vapid-key");
  const { enabled } = await res.json();
  if (enabled) {
    await apiFetch("/api/push/subscribe", { method: "DELETE" });
  } else {
    await apiFetch("/api/push/subscribe", { method: "POST" });
  }
  await refreshPushStatus();
}

async function testPushNow() {
  const btn = event.target;
  btn.textContent = "发送中…"; btn.disabled = true;
  try {
    const res = await apiFetch("/api/push/test", { method: "POST" });
    if (res.ok) alert("测试推送已发送，请查看手机通知！");
    else { const d = await res.json(); alert("发送失败：" + d.detail); }
  } catch (e) { alert("发送失败：" + e.message); }
  finally { btn.textContent = "📨 立即测试推送"; btn.disabled = false; }
}

// ── Calendar Subscription ─────────────────────────────────────────────────────

function showCalendarModal() {
  const base = window.location.origin;
  const url = `${base}/api/calendar/todos.ics?token=${encodeURIComponent(token)}`;
  document.getElementById("cal-url").textContent = url;
  showModal("calendar-modal");
}

function copyCalUrl() {
  const url = document.getElementById("cal-url").textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => alert("链接已复制！"));
  } else {
    const ta = document.createElement("textarea");
    ta.value = url; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    alert("链接已复制！");
  }
}

// ── Todo Documents ────────────────────────────────────────────────────────────

const TODO_DOC_ICONS = {
  pdf: "📄", doc: "📝", docx: "📝", xls: "📊", xlsx: "📊",
  ppt: "📋", pptx: "📋", txt: "📃", csv: "📃", md: "📃",
  jpg: "🖼", jpeg: "🖼", png: "🖼",
};

function showTodoDocs(todoId, content) {
  document.getElementById("todo-docs-todo-id").value = todoId;
  document.getElementById("todo-docs-subtitle").textContent = content;
  document.getElementById("todo-doc-file-input").value = "";
  loadTodoDocs(todoId);
  showModal("todo-docs-modal");
}

async function loadTodoDocs(todoId) {
  const el = document.getElementById("todo-docs-list");
  el.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const res = await apiFetch(`/api/todos/${todoId}/documents`);
  const docs = await res.json();
  if (!docs.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📎</div><p>暂无附件</p></div>';
    return;
  }
  el.innerHTML = docs.map((d) => {
    const ext = d.original_name.split(".").pop().toLowerCase();
    const icon = TODO_DOC_ICONS[ext] || "📎";
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="font-size:24px;flex-shrink:0;">${icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(d.original_name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${formatSize(d.size)} · ${d.uploaded_at.slice(0,10)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <a href="/api/todo_documents/${d.id}/download" target="_blank"
           style="font-size:12px;color:var(--primary);text-decoration:none;padding:5px 8px;border:1px solid var(--border);border-radius:6px;">查看</a>
        <button onclick="deleteTodoDoc(${d.id})"
          style="font-size:12px;color:var(--danger);background:none;border:1px solid var(--border);border-radius:6px;padding:5px 8px;cursor:pointer;">删除</button>
      </div>
    </div>`;
  }).join("");
}

async function handleTodoDocUpload(input) {
  const file = input.files[0];
  if (!file) return;
  const todoId = document.getElementById("todo-docs-todo-id").value;
  const btn = document.querySelector("#todo-docs-modal .btn-primary");
  _btnSpin(btn, "上传中…");
  const formData = new FormData();
  formData.append("file", file);
  try {
    const newDoc = await _xhrUpload(`${API}/api/todos/${todoId}/documents`, formData, { "X-Access-Token": token });
    input.value = "";
    loadTodoDocs(todoId);
    if (currentPage === "today") loadToday();
    if (currentTab === "todos") loadCompanyTodos();
  } catch (e) {
    alert("上传失败：" + e.message);
  } finally {
    _btnReset(btn, "＋ 上传附件");
  }
}

function deleteTodoDoc(docId) {
  showConfirm("确认删除此附件？", async () => {
    await apiFetch(`/api/todo_documents/${docId}`, { method: "DELETE" });
    const todoId = document.getElementById("todo-docs-todo-id").value;
    loadTodoDocs(todoId);
    if (currentPage === "today") loadToday();
    if (currentTab === "todos") loadCompanyTodos();
  });
}

// ── 财务状况 ─────────────────────────────────────────────────────────────────

let finYears    = [];
let finYearIdx  = 0;
let finTabIdx   = 0;
let finCurYear  = null;
let finVals     = {};   // {tabKey: {itemName: {c,p}}}
let finPrevRec  = {};   // {tabKey: {itemName: value}}  来自上一年记录
let finDirty    = false;
let finSources  = {};   // {tabKey: {itemName: {c:'ai'|'manual', p:'ai'|'manual'}}}
let finAiTotals = {};   // {tabKey: {itemName: {c,p}}} AI读取的合计行原始值
let finErrors   = {};   // {tabKey: {itemName: {c:{computed,aiVal}, p:{computed,aiVal}}}}

const FIN_TABS = [
  { label:"合并资产负债表", key:"balance_sheet",          showRatio:true  },
  { label:"本部资产负债表", key:"balance_sheet_parent",   showRatio:true  },
  { label:"合并利润表",     key:"income",                 showRatio:false },
  { label:"本部利润表",     key:"income_parent",          showRatio:false },
  { label:"合并现金流量表", key:"cash_flow_consolidated", showRatio:false },
  { label:"本部现金流量表", key:"cash_flow_parent",       showRatio:false },
];

// ── 标准科目模板（含计算公式）─────────────────────────────────────────────────
// {n:名称, t:类型, c?:计算数组}  计算数组中 "-X" 表示减去X，否则加
(function() {
  const BSA = [
    {n:"流动资产",t:"header"},
    {n:"货币资金",t:"detail"},
    {n:"交易性金融资产",t:"detail"},
    {n:"衍生金融资产",t:"detail"},
    {n:"应收票据",t:"detail"},
    {n:"应收账款",t:"detail"},
    {n:"应收款项融资",t:"detail"},
    {n:"预付款项",t:"detail"},
    {n:"其他应收款",t:"detail"},
    {n:"存货",t:"detail"},
    {n:"合同资产",t:"detail"},
    {n:"持有待售资产",t:"detail"},
    {n:"一年内到期的非流动资产",t:"detail"},
    {n:"其他流动资产",t:"detail"},
    {n:"流动资产合计",t:"subtotal",c:["货币资金","交易性金融资产","衍生金融资产","应收票据","应收账款","应收款项融资","预付款项","其他应收款","存货","合同资产","持有待售资产","一年内到期的非流动资产","其他流动资产"]},
    {n:"非流动资产",t:"header"},
    {n:"债权投资",t:"detail"},
    {n:"其他债权投资",t:"detail"},
    {n:"长期应收款",t:"detail"},
    {n:"长期股权投资",t:"detail"},
    {n:"其他权益工具投资",t:"detail"},
    {n:"其他非流动金融资产",t:"detail"},
    {n:"投资性房地产",t:"detail"},
    {n:"固定资产",t:"detail"},
    {n:"在建工程",t:"detail"},
    {n:"使用权资产",t:"detail"},
    {n:"无形资产",t:"detail"},
    {n:"开发支出",t:"detail"},
    {n:"商誉",t:"detail"},
    {n:"长期待摊费用",t:"detail"},
    {n:"递延所得税资产",t:"detail"},
    {n:"其他非流动资产",t:"detail"},
    {n:"非流动资产合计",t:"subtotal",c:["债权投资","其他债权投资","长期应收款","长期股权投资","其他权益工具投资","其他非流动金融资产","投资性房地产","固定资产","在建工程","使用权资产","无形资产","开发支出","商誉","长期待摊费用","递延所得税资产","其他非流动资产"]},
    {n:"资产总计",t:"total",c:["流动资产合计","非流动资产合计"]},
  ];
  const BSL = [
    {n:"流动负债",t:"header"},
    {n:"短期借款",t:"detail"},
    {n:"交易性金融负债",t:"detail"},
    {n:"衍生金融负债",t:"detail"},
    {n:"应付票据",t:"detail"},
    {n:"应付账款",t:"detail"},
    {n:"预收款项",t:"detail"},
    {n:"合同负债",t:"detail"},
    {n:"应付职工薪酬",t:"detail"},
    {n:"应交税费",t:"detail"},
    {n:"其他应付款",t:"detail"},
    {n:"持有待售负债",t:"detail"},
    {n:"一年内到期的非流动负债",t:"detail"},
    {n:"其他流动负债",t:"detail"},
    {n:"流动负债合计",t:"subtotal",c:["短期借款","交易性金融负债","衍生金融负债","应付票据","应付账款","预收款项","合同负债","应付职工薪酬","应交税费","其他应付款","持有待售负债","一年内到期的非流动负债","其他流动负债"]},
    {n:"非流动负债",t:"header"},
    {n:"长期借款",t:"detail"},
    {n:"应付债券",t:"detail"},
    {n:"租赁负债",t:"detail"},
    {n:"长期应付款",t:"detail"},
    {n:"预计负债",t:"detail"},
    {n:"递延收益",t:"detail"},
    {n:"递延所得税负债",t:"detail"},
    {n:"其他非流动负债",t:"detail"},
    {n:"非流动负债合计",t:"subtotal",c:["长期借款","应付债券","租赁负债","长期应付款","预计负债","递延收益","递延所得税负债","其他非流动负债"]},
    {n:"负债合计",t:"total",c:["流动负债合计","非流动负债合计"]},
  ];
  const EQC = [
    {n:"所有者权益",t:"header"},
    {n:"股本",t:"detail"},
    {n:"其他权益工具",t:"detail"},
    {n:"资本公积",t:"detail"},
    {n:"减：库存股",t:"detail"},
    {n:"其他综合收益",t:"detail"},
    {n:"专项储备",t:"detail"},
    {n:"盈余公积",t:"detail"},
    {n:"未分配利润",t:"detail"},
    {n:"归属于母公司所有者权益合计",t:"subtotal",c:["股本","其他权益工具","资本公积","-减：库存股","其他综合收益","专项储备","盈余公积","未分配利润"]},
    {n:"少数股东权益",t:"detail"},
    {n:"所有者权益合计",t:"total",c:["归属于母公司所有者权益合计","少数股东权益"]},
    {n:"负债和所有者权益总计",t:"total",c:["负债合计","所有者权益合计"]},
  ];
  const EQP = [
    {n:"所有者权益",t:"header"},
    {n:"股本",t:"detail"},
    {n:"其他权益工具",t:"detail"},
    {n:"资本公积",t:"detail"},
    {n:"减：库存股",t:"detail"},
    {n:"其他综合收益",t:"detail"},
    {n:"专项储备",t:"detail"},
    {n:"盈余公积",t:"detail"},
    {n:"未分配利润",t:"detail"},
    {n:"所有者权益合计",t:"total",c:["股本","其他权益工具","资本公积","-减：库存股","其他综合收益","专项储备","盈余公积","未分配利润"]},
    {n:"负债和所有者权益总计",t:"total",c:["负债合计","所有者权益合计"]},
  ];
  const INC_BASE = [
    {n:"营业收入",t:"total"},
    {n:"营业成本",t:"detail"},
    {n:"税金及附加",t:"detail"},
    {n:"销售费用",t:"detail"},
    {n:"管理费用",t:"detail"},
    {n:"研发费用",t:"detail"},
    {n:"财务费用",t:"detail"},
    {n:"其他收益",t:"detail"},
    {n:"投资收益",t:"detail"},
    {n:"公允价值变动收益",t:"detail"},
    {n:"信用减值损失",t:"detail"},
    {n:"资产减值损失",t:"detail"},
    {n:"资产处置收益",t:"detail"},
    {n:"营业利润",t:"subtotal",c:["营业收入","-营业成本","-税金及附加","-销售费用","-管理费用","-研发费用","-财务费用","其他收益","投资收益","公允价值变动收益","信用减值损失","资产减值损失","资产处置收益"]},
    {n:"营业外收入",t:"detail"},
    {n:"营业外支出",t:"detail"},
    {n:"利润总额",t:"subtotal",c:["营业利润","营业外收入","-营业外支出"]},
    {n:"所得税费用",t:"detail"},
    {n:"净利润",t:"total",c:["利润总额","-所得税费用"]},
  ];
  const CF = [
    {n:"经营活动产生的现金流量",t:"header"},
    {n:"销售商品、提供劳务收到的现金",t:"detail"},
    {n:"收到的税费返还",t:"detail"},
    {n:"收到其他与经营活动有关的现金",t:"detail"},
    {n:"经营活动现金流入小计",t:"subtotal",c:["销售商品、提供劳务收到的现金","收到的税费返还","收到其他与经营活动有关的现金"]},
    {n:"购买商品、接受劳务支付的现金",t:"detail"},
    {n:"支付给职工以及为职工支付的现金",t:"detail"},
    {n:"支付的各项税费",t:"detail"},
    {n:"支付其他与经营活动有关的现金",t:"detail"},
    {n:"经营活动现金流出小计",t:"subtotal",c:["购买商品、接受劳务支付的现金","支付给职工以及为职工支付的现金","支付的各项税费","支付其他与经营活动有关的现金"]},
    {n:"经营活动产生的现金流量净额",t:"total",c:["经营活动现金流入小计","-经营活动现金流出小计"]},
    {n:"投资活动产生的现金流量",t:"header"},
    {n:"收回投资收到的现金",t:"detail"},
    {n:"取得投资收益收到的现金",t:"detail"},
    {n:"处置固定资产等收回的现金净额",t:"detail"},
    {n:"处置子公司及其他营业单位收到的现金净额",t:"detail"},
    {n:"收到其他与投资活动有关的现金",t:"detail"},
    {n:"投资活动现金流入小计",t:"subtotal",c:["收回投资收到的现金","取得投资收益收到的现金","处置固定资产等收回的现金净额","处置子公司及其他营业单位收到的现金净额","收到其他与投资活动有关的现金"]},
    {n:"购建固定资产、无形资产支付的现金",t:"detail"},
    {n:"投资支付的现金",t:"detail"},
    {n:"取得子公司及其他营业单位支付的现金净额",t:"detail"},
    {n:"支付其他与投资活动有关的现金",t:"detail"},
    {n:"投资活动现金流出小计",t:"subtotal",c:["购建固定资产、无形资产支付的现金","投资支付的现金","取得子公司及其他营业单位支付的现金净额","支付其他与投资活动有关的现金"]},
    {n:"投资活动产生的现金流量净额",t:"total",c:["投资活动现金流入小计","-投资活动现金流出小计"]},
    {n:"筹资活动产生的现金流量",t:"header"},
    {n:"吸收投资收到的现金",t:"detail"},
    {n:"取得借款收到的现金",t:"detail"},
    {n:"收到其他与筹资活动有关的现金",t:"detail"},
    {n:"筹资活动现金流入小计",t:"subtotal",c:["吸收投资收到的现金","取得借款收到的现金","收到其他与筹资活动有关的现金"]},
    {n:"偿还债务支付的现金",t:"detail"},
    {n:"分配股利、利润或偿付利息支付的现金",t:"detail"},
    {n:"支付其他与筹资活动有关的现金",t:"detail"},
    {n:"筹资活动现金流出小计",t:"subtotal",c:["偿还债务支付的现金","分配股利、利润或偿付利息支付的现金","支付其他与筹资活动有关的现金"]},
    {n:"筹资活动产生的现金流量净额",t:"total",c:["筹资活动现金流入小计","-筹资活动现金流出小计"]},
    {n:"汇率变动对现金及现金等价物的影响",t:"detail"},
    {n:"现金及现金等价物净增加额",t:"total",c:["经营活动产生的现金流量净额","投资活动产生的现金流量净额","筹资活动产生的现金流量净额","汇率变动对现金及现金等价物的影响"]},
    {n:"期初现金及现金等价物余额",t:"detail"},
    {n:"期末现金及现金等价物余额",t:"total",c:["期初现金及现金等价物余额","现金及现金等价物净增加额"]},
  ];
  window.FIN_TEMPLATES = {
    balance_sheet:          [...BSA,...BSL,...EQC],
    balance_sheet_parent:   [...BSA,...BSL,...EQP],
    income: [...INC_BASE,
      {n:"归属于母公司所有者的净利润",t:"detail"},
      {n:"少数股东损益",t:"detail"},
      {n:"其他综合收益的税后净额",t:"subtotal"},
      {n:"综合收益总额",t:"total",c:["净利润","其他综合收益的税后净额"]},
      {n:"归属于母公司所有者的综合收益总额",t:"detail"},
      {n:"归属于少数股东的综合收益总额",t:"detail"},
      {n:"基本每股收益",t:"detail"},
      {n:"稀释每股收益",t:"detail"},
    ],
    income_parent: [...INC_BASE,
      {n:"其他综合收益的税后净额",t:"subtotal"},
      {n:"综合收益总额",t:"total",c:["净利润","其他综合收益的税后净额"]},
      {n:"基本每股收益",t:"detail"},
      {n:"稀释每股收益",t:"detail"},
    ],
    cash_flow_consolidated: CF,
    cash_flow_parent:       CF,
  };
})();

// ─── 校验引擎 ────────────────────────────────────────────────────────────────

function finValidate() {
  finErrors = {};
  const TOL = 1.0; // 1万元容差，避免尾差误报
  for (const tab of FIN_TABS) {
    const key = tab.key;
    finErrors[key] = {};
    for (const row of (FIN_TEMPLATES[key] || [])) {
      if (!row.c) continue;
      const ai = finAiTotals[key]?.[row.n];
      if (!ai) continue;
      for (const col of ['c', 'p']) {
        const computed = finGetVal(key, row.n, col);
        const aiVal    = ai[col];
        if (computed == null || aiVal == null) continue;
        if (Math.abs(computed - aiVal) > TOL) {
          if (!finErrors[key][row.n]) finErrors[key][row.n] = {};
          finErrors[key][row.n][col] = { computed, aiVal };
        }
      }
    }
  }
  return finErrors;
}

function _countErrors() {
  return Object.values(finErrors).reduce((s, t) => s + Object.keys(t).length, 0);
}

// ─── 计算引擎 ────────────────────────────────────────────────────────────────

function _finGetRaw(key, name, col) {
  if (col === 'p') return finPrevRec[key]?.[name] ?? finVals[key]?.[name]?.p ?? null;
  return finVals[key]?.[name]?.c ?? null;
}

function finGetVal(key, name, col) {
  const row = FIN_TEMPLATES[key]?.find(r => r.n === name);
  if (row?.c) {
    let sum = null;
    for (const item of row.c) {
      const neg = item[0] === '-';
      const nm = neg ? item.slice(1) : item;
      const v = finGetVal(key, nm, col);
      if (v != null) { sum = (sum ?? 0) + (neg ? -v : v); }
    }
    return sum === null ? null : Math.round(sum * 100) / 100;
  }
  return _finGetRaw(key, name, col);
}

// ─── 数据加载 ────────────────────────────────────────────────────────────────

function _itemsToVals(items) {
  const m = {};
  for (const it of (items || [])) if (it.name) m[it.name] = { c: it.current ?? null, p: it.prev ?? null };
  return m;
}

function _showFinToolbar(hasYear) {
  document.getElementById("fin-delete-btn").style.display = hasYear ? "inline-block" : "none";
  document.getElementById("fin-save-btn").style.display   = hasYear ? "inline-block" : "none";
  document.getElementById("fin-legend").style.display     = hasYear ? "flex" : "none";
}

async function loadFinancials() {
  const res  = await apiFetch(`/api/companies/${currentCompanyId}/financials`);
  const list = await res.json();
  finYears   = list.map(r => r.year);
  finYearIdx = 0;
  if (finYears.length === 0) {
    document.getElementById("fin-year-label").textContent = "—";
    _showFinToolbar(false);
    document.getElementById("fin-content").innerHTML =
      `<div class="empty"><div class="empty-icon">📊</div><p>暂无财务数据</p>
       <p style="font-size:13px;margin-top:6px;">点击「＋年份」手动填写，或上传PDF后点击「🤖 AI提取」</p></div>`;
    return;
  }
  await renderFinYear();
}

async function renderFinYear() {
  const year = finYears[finYearIdx];
  finCurYear  = year;
  finDirty    = false;
  document.getElementById("fin-year-label").textContent = year + "年";
  _showFinToolbar(true);
  _updateSaveBtn();

  const allKeys = FIN_TABS.map(t => t.key);
  const [r1, r2] = await Promise.all([
    apiFetch(`/api/companies/${currentCompanyId}/financials/${year}`),
    finYears[finYearIdx + 1]
      ? apiFetch(`/api/companies/${currentCompanyId}/financials/${finYears[finYearIdx + 1]}`)
      : Promise.resolve(null),
  ]);
  const data     = await r1.json();
  const prevData = r2 ? await r2.json() : null;

  finVals     = {};
  finPrevRec  = {};
  finSources  = {};
  finAiTotals = {};
  finErrors   = {};
  for (const k of allKeys) {
    finVals[k]    = _itemsToVals(data[k]);
    finPrevRec[k] = {};
    if (prevData) {
      for (const it of (prevData[k] || [])) if (it.name) finPrevRec[k][it.name] = it.current ?? null;
    } else {
      // 没有独立上年记录时，用 prev 字段
      for (const [nm, v] of Object.entries(finVals[k])) if (v.p != null) finPrevRec[k][nm] = v.p;
    }
  }
  renderFinContent();
}

function renderFinContent() {
  document.getElementById("fin-content").innerHTML = _buildFinTable();
}

function setFinTab(i) {
  finTabIdx = i;
  renderFinContent();
  document.querySelectorAll(".fin-tab")[i]?.scrollIntoView({behavior:"smooth",block:"nearest",inline:"center"});
}

function finPrevYear() { if (finYearIdx < finYears.length-1) { finYearIdx++; renderFinYear(); } }
function finNextYear() { if (finYearIdx > 0)                 { finYearIdx--; renderFinYear(); } }

// ─── 渲染 ────────────────────────────────────────────────────────────────────

function _buildFinTable() {
  const tab  = FIN_TABS[finTabIdx];
  const key  = tab.key;
  const tmpl = FIN_TEMPLATES[key];
  const prevYear = finYears[finYearIdx + 1];

  const totalAssets = tab.showRatio ? (finGetVal(key, "资产总计", 'c') || 0) : 0;

  const fmtN = v => v == null ? "" : Number(v).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});

  const tabBar = FIN_TABS.map((t,i) => {
    const has = Object.values(finVals[t.key] || {}).some(v => v.c != null);
    return `<button class="fin-tab${finTabIdx===i?" active":""}${has?"":" fin-tab-empty"}" onclick="setFinTab(${i})">${t.label}</button>`;
  }).join("");

  const thead = `<tr class="fin-thead">
    <th class="fin-name">科目</th>
    <th class="fin-val">${finCurYear}年</th>
    <th class="fin-val fin-prev">${prevYear ? prevYear+"年" : "上年"}</th>
    <th class="fin-val" style="font-size:11px;">变化</th></tr>`;

  const rows = tmpl.map(row => {
    const isHdr  = row.t === "header";
    const isCalc = !!row.c;  // subtotal/total with formula
    const curV   = finGetVal(key, row.n, 'c');
    const prevV  = finGetVal(key, row.n, 'p');

    let flagRatio = false;
    if (tab.showRatio && totalAssets > 0 && curV != null && !isHdr)
      flagRatio = Math.abs(curV) / totalAssets > 0.1;

    let changeStr = "", changeClass = "";
    if (prevV != null && prevV !== 0 && curV != null && !isHdr) {
      const pct = (curV - prevV) / Math.abs(prevV);
      changeStr  = (pct >= 0 ? "+" : "") + (pct * 100).toFixed(1) + "%";
      changeClass = (pct > 0 ? "fin-chg-up" : "fin-chg-dn") + (Math.abs(pct) > 0.2 ? " fin-flag-change" : "");
    }

    const rc = [
      isHdr             ? "fin-row-header"  : "",
      row.t === "total" ? "fin-row-total"   : "",
      row.t === "subtotal"?"fin-row-subtotal": "",
      flagRatio         ? "fin-hl-ratio"    : "",
    ].filter(Boolean).join(" ");
    const indent = isHdr || row.t==="total" ? "" : row.t==="subtotal" ? "fin-indent1" : "fin-indent2";

    const errC = finErrors[key]?.[row.n]?.c;
    const errP = finErrors[key]?.[row.n]?.p;
    const srcC = finSources[key]?.[row.n]?.c;
    const srcP = finSources[key]?.[row.n]?.p;

    let cCell;
    if (isHdr) {
      cCell = `<td></td><td></td><td></td>`;
    } else if (isCalc) {
      const wC = errC ? ' fin-cell-warn' : '';
      const wP = errP ? ' fin-cell-warn' : '';
      const tipC = errC ? ` title="AI读取:${fmtN(errC.aiVal)}  计算:${fmtN(errC.computed)}"` : '';
      const tipP = errP ? ` title="AI读取:${fmtN(errP.aiVal)}  计算:${fmtN(errP.computed)}"` : '';
      const badgeC = errC ? `<span class="fin-warn-badge" title="AI:${fmtN(errC.aiVal)}">⚠</span>` : '';
      const badgeP = errP ? `<span class="fin-warn-badge" title="AI:${fmtN(errP.aiVal)}">⚠</span>` : '';
      cCell = `<td class="fin-val fin-calc${wC}"${tipC}>${fmtN(curV)||"—"}${badgeC}</td>
               <td class="fin-val fin-calc fin-prev${wP}"${tipP}>${fmtN(prevV)||"—"}${badgeP}</td>
               <td class="fin-val ${changeClass}" style="font-size:11px;">${changeStr}</td>`;
    } else {
      const esc = row.n.replace(/'/g,"\\'");
      const bgC = srcC === 'ai' ? ' fin-cell-ai' : srcC === 'manual' ? ' fin-cell-manual' : '';
      const bgP = srcP === 'ai' ? ' fin-cell-ai' : srcP === 'manual' ? ' fin-cell-manual' : '';
      cCell = `<td class="fin-val fin-editable${bgC}" onclick="finEdit(this,'${key}','${esc}','c')">${curV!=null?fmtN(curV):'<span class="fin-ph">—</span>'}</td>
               <td class="fin-val fin-editable fin-prev${bgP}" onclick="finEdit(this,'${key}','${esc}','p')">${prevV!=null?fmtN(prevV):'<span class="fin-ph">—</span>'}</td>
               <td class="fin-val ${changeClass}" style="font-size:11px;">${changeStr}</td>`;
    }

    return `<tr class="${rc}"><td class="fin-name ${indent}">${row.n}${flagRatio?'<span class="fin-dot fin-dot-r"></span>':''}</td>${cCell}</tr>`;
  }).join("");

  const tabErrCount = Object.keys(finErrors[key] || {}).length;
  const banner = tabErrCount > 0
    ? `<div class="fin-validation-banner">⚠ ${tabErrCount} 个合计行与明细项目不符（橙色标记），请逐一核对后手动修正</div>`
    : (Object.keys(finAiTotals[key] || {}).length > 0
        ? `<div class="fin-ok-banner">✓ 合计关系校验通过</div>`
        : '');

  return `<div class="fin-tabs-scroll">${tabBar}</div>${banner}
<div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
<table class="fin-table"><thead>${thead}</thead><tbody>${rows}</tbody></table></div>`;
}

// ─── 内联编辑 ────────────────────────────────────────────────────────────────

function finEdit(td, key, name, col) {
  if (td.querySelector("input")) return;
  const cur = col === 'p' ? (finPrevRec[key]?.[name] ?? finVals[key]?.[name]?.p ?? null)
                          : (finVals[key]?.[name]?.c ?? null);
  td.innerHTML = `<input type="number" class="fin-cell-input" step="0.01" value="${cur??''}"
    onblur="finSave(this,'${key}','${name}','${col}')"
    onkeydown="if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();this.blur();}
               if(event.key==='Escape'){this.dataset.esc='1';this.blur();}">`;
  td.firstChild.focus();
  td.firstChild.select();
}

function finSave(input, key, name, col) {
  if (input.dataset.esc) { renderFinContent(); return; }
  const val = input.value === '' ? null : Math.round(parseFloat(input.value) * 100) / 100;
  if (!finVals[key])       finVals[key] = {};
  if (!finVals[key][name]) finVals[key][name] = {c:null, p:null};
  if (col === 'p') {
    finVals[key][name].p = val;
    if (!finPrevRec[key]) finPrevRec[key] = {};
    finPrevRec[key][name] = val;
  } else {
    finVals[key][name].c = val;
  }
  if (!finSources[key]) finSources[key] = {};
  if (!finSources[key][name]) finSources[key][name] = {c: null, p: null};
  finSources[key][name][col] = 'manual';
  if (Object.keys(finAiTotals).length > 0) finValidate();
  finDirty = true;
  renderFinContent();
  _updateSaveBtn();
}

function _updateSaveBtn() {
  const btn = document.getElementById("fin-save-btn");
  if (!btn) return;
  btn.textContent = finDirty ? "💾 保存*" : "💾 保存";
  btn.style.background = finDirty ? "var(--primary)" : "";
  btn.style.color      = finDirty ? "#fff"           : "";
  btn.style.borderColor= finDirty ? "var(--primary)" : "";
}

// ─── 新增年份 ────────────────────────────────────────────────────────────────

function addFinYear() {
  const input = prompt("输入年份（如 2023）：");
  if (!input) return;
  const y = parseInt(input);
  if (isNaN(y) || y < 2000 || y > 2100) { alert("年份无效"); return; }
  if (finYears.includes(y)) {
    finYearIdx = finYears.indexOf(y);
    renderFinYear();
    return;
  }
  finYears.push(y);
  finYears.sort((a, b) => b - a);
  finYearIdx = finYears.indexOf(y);
  finCurYear = y;
  finVals     = Object.fromEntries(FIN_TABS.map(t => [t.key, {}]));
  finPrevRec  = Object.fromEntries(FIN_TABS.map(t => [t.key, {}]));
  finSources  = Object.fromEntries(FIN_TABS.map(t => [t.key, {}]));
  finAiTotals = Object.fromEntries(FIN_TABS.map(t => [t.key, {}]));
  finErrors   = Object.fromEntries(FIN_TABS.map(t => [t.key, {}]));
  finDirty    = false;
  document.getElementById("fin-year-label").textContent = y + "年";
  _showFinToolbar(true);
  _updateSaveBtn();
  renderFinContent();
}

// ─── 保存 ────────────────────────────────────────────────────────────────────

async function saveFinYear() {
  const btn = document.getElementById("fin-save-btn");
  btn.disabled = true; btn.textContent = "保存中…";
  try {
    const allKeys = FIN_TABS.map(t => t.key);
    const payload = { year: finCurYear, unit: "万元", source_doc: "" };
    for (const k of allKeys) {
      payload[k] = (FIN_TEMPLATES[k] || [])
        .filter(r => r.t !== "header")
        .map(r => ({ name: r.n, current: finGetVal(k, r.n, 'c'), prev: null, type: r.t }));
    }
    await apiFetch(`/api/companies/${currentCompanyId}/financials`, {
      method: "POST", body: JSON.stringify(payload),
    });
    finDirty = false;
    if (!finYears.includes(finCurYear)) {
      finYears.push(finCurYear);
      finYears.sort((a, b) => b - a);
      finYearIdx = finYears.indexOf(finCurYear);
    }
    btn.textContent = "✓ 已保存";
    setTimeout(() => { btn.textContent = "💾 保存"; _updateSaveBtn(); btn.disabled = false; }, 1500);
  } catch(e) {
    alert("保存失败：" + e.message);
    btn.disabled = false; btn.textContent = "💾 保存";
  }
}

// ─── AI 提取 ────────────────────────────────────────────────────────────────

async function extractFinancials() {
  const btn = document.getElementById("fin-extract-btn");
  btn.textContent = "提取中…"; btn.disabled = true;
  try {
    const res = await apiFetch(`/api/companies/${currentCompanyId}/financials/extract`, { method: "POST" });
    if (!res.ok) { const d = await res.json(); alert("提取失败：" + (d.detail||"未知错误")); return; }
    const data = await res.json();
    if (!data.year) { alert("AI未能识别年份，请检查PDF内容"); return; }
    _applyExtractedFinData(data);
  } catch(e) {
    alert("提取失败：" + e.message);
  } finally {
    btn.textContent = "🤖 AI提取"; btn.disabled = false;
  }
}

// ─── 通用：将提取结果填入财务表格 ────────────────────────────────────────────

function _applyExtractedFinData(data) {
  const allKeys = FIN_TABS.map(t => t.key);
  const _normName = s => s.replace(/^[\s　]*[（(]?[一二三四五六七八九十\d]+[）)]?[、。.：: ]+/, '').trim();
  const isNewYear = !finYears.includes(data.year);

  if (isNewYear) {
    finYears.push(data.year);
    finYears.sort((a, b) => b - a);
    finYearIdx = finYears.indexOf(data.year);
    finCurYear = data.year;
    document.getElementById("fin-year-label").textContent = data.year + "年";
    finVals     = Object.fromEntries(allKeys.map(k => [k, {}]));
    finPrevRec  = Object.fromEntries(allKeys.map(k => [k, {}]));
    finSources  = Object.fromEntries(allKeys.map(k => [k, {}]));
    finAiTotals = Object.fromEntries(allKeys.map(k => [k, {}]));
    finErrors   = Object.fromEntries(allKeys.map(k => [k, {}]));
  }

  for (const k of allKeys) {
    const raw = data[k] || [];
    const lookup = {};
    for (const it of raw) {
      if (!it.name) continue;
      lookup[it.name] = it;
      lookup[_normName(it.name)] = it;
    }
    if (!finVals[k])     finVals[k]     = {};
    if (!finSources[k])  finSources[k]  = {};
    if (!finAiTotals[k]) finAiTotals[k] = {};
    for (const row of (FIN_TEMPLATES[k] || [])) {
      if (row.t === "header") continue;
      const match = lookup[row.n] || lookup[_normName(row.n)];
      if (row.c) {
        if (match) finAiTotals[k][row.n] = { c: match.current ?? null, p: match.prev ?? null };
      } else {
        if (match) {
          finVals[k][row.n] = { c: match.current ?? null, p: match.prev ?? null };
          if (match.prev != null) {
            if (!finPrevRec[k]) finPrevRec[k] = {};
            finPrevRec[k][row.n] = match.prev;
          }
          finSources[k][row.n] = {
            c: match.current != null ? 'ai' : null,
            p: match.prev    != null ? 'ai' : null,
          };
        }
      }
    }
  }

  finValidate();
  _showFinToolbar(true);
  finDirty = true;
  renderFinContent();
  _updateSaveBtn();

  const filled = allKeys.filter(k => Object.values(finVals[k]||{}).some(v=>v.c!=null));
  const lbl = {balance_sheet:"合并资产负债表",income:"合并利润表",balance_sheet_parent:"本部资产负债表",
               income_parent:"本部利润表",cash_flow_consolidated:"合并现金流量表",cash_flow_parent:"本部现金流量表"};
  const errN = _countErrors();
  const errMsg = errN > 0 ? `\n⚠ ${errN} 个合计行与明细不符，已标橙色，请核对` : '\n✓ 合计关系校验通过';
  alert(`✅ 已填入 ${data.year} 年数据：${filled.map(k=>lbl[k]).join("、")||"无"}${errMsg}\n请检查后点击「💾 保存」`);
}

// ─── Excel 上传提取 ──────────────────────────────────────────────────────────

async function handleFinExcelUpload(input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  input.value = "";
  const btn = document.getElementById("fin-excel-btn");
  const merged = {};
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    _btnSpin(btn, `解析中 ${i + 1}/${files.length}…`);
    try {
      const fd = new FormData();
      fd.append("file", files[i]);
      const data = await _xhrUpload(
        `${API}/api/companies/${currentCompanyId}/financials/extract-excel`,
        fd, { "X-Access-Token": token }
      );
      // 合并：数组取非空的，标量取第一个有值的
      for (const k of Object.keys(data)) {
        if (Array.isArray(data[k])) {
          if (data[k].length > 0 && !(merged[k] && merged[k].length > 0))
            merged[k] = data[k];
        } else {
          if (data[k] != null && merged[k] == null) merged[k] = data[k];
        }
      }
    } catch (e) {
      errors.push(`${files[i].name}：${e.message}`);
    }
  }

  _btnReset(btn, "📊 上传Excel");
  if (errors.length) alert("部分文件解析失败：\n" + errors.join("\n"));
  if (!merged.year) { alert("未能识别年份，请确认文件名或表头含有年份（如 2024）"); return; }
  _applyExtractedFinData(merged);
}

// ─── 删除 ────────────────────────────────────────────────────────────────────

function deleteFinancials() {
  if (!finCurYear) return;
  showConfirm(`删除 ${finCurYear} 年财务数据？`, async () => {
    await apiFetch(`/api/companies/${currentCompanyId}/financials/${finCurYear}`, { method:"DELETE" });
    finVals = {}; finPrevRec = {}; finSources = {}; finAiTotals = {}; finErrors = {}; finDirty = false;
    await loadFinancials();
  });
}

// ── 股权图谱 ──────────────────────────────────────────────────────────────────

async function uploadEquityImage(input) {
  const file = input.files[0];
  if (!file) return;
  const btn = document.getElementById("equity-upload-btn");
  const el = document.getElementById("equity-chart");
  _btnSpin(btn, "识别中…");
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:12px;">
    <div class="spinner"></div><div style="font-size:13px;color:var(--text-muted);">AI 识别股权结构中…</div></div>`;
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch(`/api/companies/${currentCompanyId}/equity-image`, {
      method: "POST", headers: { "X-Access-Token": token }, body: fd,
    });
    const d = await r.json();
    _btnReset(btn, "📷 上传截图");
    input.value = "";
    _showEquityResult(d.url, d.data);
  } catch (e) {
    _btnReset(btn, "📷 上传截图");
    el.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">上传失败，请重试</div>`;
  }
}

function _showEquityResult(url, data) {
  _equityData = (data && !data.error) ? data : null;
  const el = document.getElementById("equity-chart");
  if (data && !data.error) {
    el.innerHTML = `<div style="padding:0;overflow:auto;height:100%;box-sizing:border-box;" id="equity-inner"></div>`;
    _renderEquityChart(document.getElementById("equity-inner"), data);
  } else {
    el.innerHTML = `<div style="padding:16px;text-align:center;">
      ${data?.error ? `<div style="font-size:13px;color:#d97706;padding:20px;">⚠️ ${escHtml(data.error)}</div>` : ""}
      ${!data?.error ? `<div style="color:var(--text-muted);padding:40px 0;font-size:13px;">AI识别失败，请重新上传截图</div>` : ""}
    </div>`;
  }
}

async function deleteEquityImage() {
  if (!confirm("删除截图？")) return;
  await apiFetch(`/api/companies/${currentCompanyId}/equity-image`, { method: "DELETE" });
  loadEquityTab();
}

async function loadEquityTab() {
  const el = document.getElementById("equity-chart");
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:200px;">
    <div class="spinner"></div></div>`;
  try {
    const res = await apiFetch(`/api/companies/${currentCompanyId}/equity-image-url`);
    const { url, data } = await res.json();
    if (url || data) { _showEquityResult(url, data); return; }
  } catch (_) {}
  el.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;gap:12px;color:var(--text-muted);">
    <div style="font-size:40px;">📊</div>
    <div style="font-size:13px;text-align:center;">上传企查查 / 天眼查股权截图<br>AI 自动识别生成结构图</div>
  </div>`;
}

function _renderEquityChart(container, data) {
  const T = {
    target:  { color: "#2563eb", bg: "#eff6ff", icon: "🏢", label: "目标企业" },
    company: { color: "#0891b2", bg: "#ecfeff", icon: "🏭", label: "企业"     },
    person:  { color: "#d97706", bg: "#fffbeb", icon: "👤", label: "自然人"   },
    state:   { color: "#7c3aed", bg: "#f5f3ff", icon: "🏛",  label: "国有/国资"},
  };

  const NW = 136, NH = 54, HG = 22, VG = 52;

  function subtreeW(node, key) {
    const kids = node[key] || [];
    if (!kids.length) return NW;
    return Math.max(NW, kids.reduce((s, k) => s + subtreeW(k, key) + HG, -HG));
  }

  function doLayout(node, key, cx, y, dir, pid, nodes, edges) {
    const id = nodes.length;
    nodes.push({ node, cx, y });
    if (pid !== null) edges.push({ from: pid, to: id });
    const kids = node[key] || [];
    if (!kids.length) return;
    const tw = kids.reduce((s, k) => s + subtreeW(k, key) + HG, -HG);
    let lx = cx - tw / 2;
    kids.forEach(k => {
      const kw = subtreeW(k, key);
      doLayout(k, key, lx + kw / 2, y + dir * (NH + VG), dir, id, nodes, edges);
      lx += kw + HG;
    });
  }

  function maxLevels(arr, key) {
    function d(n) { const k = n[key]||[]; return k.length ? 1+Math.max(...k.map(d)) : 1; }
    return arr.length ? Math.max(...arr.map(d)) : 0;
  }

  const shareholders = data.shareholders || data.children || [];
  const investments  = data.investments  || [];
  const upW   = shareholders.length ? shareholders.reduce((s,k)=>s+subtreeW(k,'shareholders')+HG,-HG) : 0;
  const downW = investments.length  ? investments.reduce((s,k)=>s+subtreeW(k,'investments')+HG,-HG)   : 0;
  const upLevels = maxLevels(shareholders, 'shareholders');
  const targetCX = Math.max(NW, upW, downW) / 2 + 14;
  const targetY  = upLevels * (NH + VG) + 14;

  const nodes = [], edges = [];
  nodes.push({ node: data, cx: targetCX, y: targetY });

  if (shareholders.length) {
    const tw = shareholders.reduce((s,k)=>s+subtreeW(k,'shareholders')+HG,-HG);
    let lx = targetCX - tw/2;
    shareholders.forEach(s => {
      const kw = subtreeW(s, 'shareholders');
      doLayout(s, 'shareholders', lx+kw/2, targetY-(NH+VG), -1, 0, nodes, edges);
      lx += kw + HG;
    });
  }
  if (investments.length) {
    const tw = investments.reduce((s,k)=>s+subtreeW(k,'investments')+HG,-HG);
    let lx = targetCX - tw/2;
    investments.forEach(s => {
      const kw = subtreeW(s, 'investments');
      doLayout(s, 'investments', lx+kw/2, targetY+(NH+VG), 1, 0, nodes, edges);
      lx += kw + HG;
    });
  }

  const pad = 16;
  const minX  = Math.min(...nodes.map(n => n.cx - NW/2)) - pad;
  const maxXv = Math.max(...nodes.map(n => n.cx + NW/2)) + pad;
  const minY  = Math.min(...nodes.map(n => n.y))         - pad;
  const maxYv = Math.max(...nodes.map(n => n.y + NH))    + pad;
  const W = maxXv - minX, H = maxYv - minY;
  nodes.forEach(n => { n.cx -= minX; n.y -= minY; });

  let svgPaths = "";
  edges.forEach(({ from, to }) => {
    const fn = nodes[from], tn = nodes[to];
    const isUp = tn.y + NH/2 < fn.y + NH/2;
    const x1 = fn.cx, y1 = isUp ? fn.y       : fn.y + NH;
    const x2 = tn.cx, y2 = isUp ? tn.y + NH  : tn.y;
    const my = (y1 + y2) / 2;
    svgPaths += `<path d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>`;
    const pct = tn.node.value;
    if (pct) {
      const lx = (x1 + x2) / 2, ly = my;
      const tw2 = Math.max(30, pct.length * 6.5 + 10);
      svgPaths += `<rect x="${lx-tw2/2}" y="${ly-9}" width="${tw2}" height="18" rx="9" fill="white" stroke="#e2e8f0" stroke-width="1"/>
        <text x="${lx}" y="${ly+1}" text-anchor="middle" dominant-baseline="middle" font-size="10" font-weight="600" fill="#475569">${escHtml(pct)}</text>`;
    }
  });

  let nodesHtml = "";
  const nodeMap = {};
  nodes.forEach(({ node, cx, y }, i) => {
    nodeMap[i] = node;
    const t = T[node.type] || T.company;
    const isTarget = node.type === 'target';
    const editColor = isTarget ? 'rgba(255,255,255,.7)' : '#94a3b8';
    nodesHtml += `<div style="position:absolute;left:${cx-NW/2}px;top:${y}px;width:${NW}px;height:${NH}px;
      background:${isTarget?t.color:'#fff'};border:2px solid ${t.color};border-radius:10px;
      box-shadow:0 2px 8px rgba(0,0,0,${isTarget?.14:.07});
      display:flex;flex-direction:column;justify-content:center;padding:4px 8px;box-sizing:border-box;overflow:hidden;">
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:14px;line-height:1;flex-shrink:0;">${t.icon}</span>
        <span style="font-size:11px;font-weight:600;line-height:1.3;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          color:${isTarget?'#fff':'#1e293b'};" title="${escHtml(node.name)}">${escHtml(node.name)}</span>
        <button onclick="event.stopPropagation();_editEquityNode(${i})"
          style="flex-shrink:0;background:none;border:none;cursor:pointer;padding:2px 0 2px 2px;
          font-size:12px;line-height:1;color:${editColor};opacity:.8;" title="编辑">✏</button>
      </div>
      <div style="margin-top:3px;">
        <span style="font-size:9px;padding:1px 7px;border-radius:6px;
          color:${isTarget?'rgba(255,255,255,.8)':t.color};
          background:${isTarget?'rgba(255,255,255,.18)':t.bg};">${t.label||'企业'}</span>
      </div>
    </div>`;
  });
  _equityNodeMap = nodeMap;

  container.style.overflow = 'hidden';
  container.style.padding = '0';
  container.style.touchAction = 'none';
  if (!shareholders.length && !investments.length) {
    container.innerHTML = `<div style="text-align:center;color:#94a3b8;font-size:12px;padding:40px 0;">暂无股东/投资数据</div>`;
    return;
  }
  container.innerHTML = `<div id="_eq_wrap" style="position:relative;width:${W}px;height:${H}px;transform-origin:0 0;will-change:transform;">
    <svg style="position:absolute;top:0;left:0;pointer-events:none;" width="${W}" height="${H}">
      ${svgPaths}
    </svg>
    ${nodesHtml}
  </div>`;

  const wrap = container.querySelector('#_eq_wrap');
  const cw = container.clientWidth || 360;
  const ch = container.clientHeight || 400;
  let scale = Math.min(1, (cw - 32) / W, (ch - 32) / H);
  let tx = (cw - W * scale) / 2;
  let ty = Math.max(16, (ch - H * scale) / 2);

  function applyT() {
    wrap.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  }
  applyT();

  // ── desktop: re-enable overflow scroll ──
  if (window.matchMedia('(min-width:900px)').matches) {
    container.style.overflow = 'auto';
    container.style.touchAction = '';
    wrap.style.transform = '';
    wrap.style.margin = '16px auto';
    return;
  }

  // ── touch: pan + pinch zoom ──
  let t0 = null, startTx = 0, startTy = 0;
  let startDist = 0, startScale = 1, pinchOriginX = 0, pinchOriginY = 0;
  let lastTap = 0;

  container.addEventListener('touchstart', e => {
    e.preventDefault();
    startTx = tx; startTy = ty;
    if (e.touches.length === 1) {
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, n: 1 };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      startDist = Math.hypot(dx, dy);
      startScale = scale;
      const rect = container.getBoundingClientRect();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      pinchOriginX = (mx - tx) / scale;
      pinchOriginY = (my - ty) / scale;
      t0 = { x: mx, y: my, n: 2 };
    }
  }, { passive: false });

  container.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!t0) return;
    const rect = container.getBoundingClientRect();
    if (e.touches.length === 1 && t0.n === 1) {
      tx = startTx + e.touches[0].clientX - t0.x;
      ty = startTy + e.touches[0].clientY - t0.y;
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newScale = Math.min(4, Math.max(0.3, startScale * Math.hypot(dx, dy) / startDist));
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      tx = mx - pinchOriginX * newScale;
      ty = my - pinchOriginY * newScale;
      scale = newScale;
    }
    applyT();
  }, { passive: false });

  container.addEventListener('touchend', e => {
    if (e.touches.length === 0) {
      // double-tap to reset
      const now = Date.now();
      if (now - lastTap < 280) {
        scale = Math.min(1, (cw - 32) / W, (ch - 32) / H);
        tx = (cw - W * scale) / 2;
        ty = Math.max(16, (ch - H * scale) / 2);
        applyT();
      }
      lastTap = now;
      t0 = null;
    } else if (e.touches.length === 1) {
      // transition from pinch to single-finger pan
      startTx = tx; startTy = ty;
      t0 = { x: e.touches[0].clientX, y: e.touches[0].clientY, n: 1 };
    }
  }, { passive: false });
}

// ── 股权节点编辑 ──────────────────────────────────────────────────────────────

let _editingNid = null;

function _ensureEquityEditModal() {
  if (document.getElementById('_eq_edit_modal')) return;
  const m = document.createElement('div');
  m.id = '_eq_edit_modal';
  m.style.cssText = 'display:none;position:fixed;inset:0;z-index:600;background:rgba(0,0,0,.5);align-items:center;justify-content:center;';
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px 20px 20px;width:min(92%,360px);box-shadow:0 8px 32px rgba(0,0,0,.18);">
      <div style="font-size:16px;font-weight:700;margin-bottom:18px;color:#1e293b;">编辑节点</div>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:5px;">名称</div>
        <input id="_eq_edit_name" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;font-family:inherit;"
          onkeydown="if(event.key==='Enter')_saveEquityNode()">
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:5px;">持股比例</div>
        <input id="_eq_edit_value" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;outline:none;font-family:inherit;" placeholder="如 51.00%"
          onkeydown="if(event.key==='Enter')_saveEquityNode()">
      </div>
      <div id="_eq_edit_type_row" style="margin-bottom:18px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:5px;">类型</div>
        <select id="_eq_edit_type" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;font-size:14px;background:#fff;font-family:inherit;">
          <option value="company">🏭 企业</option>
          <option value="person">👤 自然人</option>
          <option value="state">🏛 国有/国资</option>
        </select>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="_saveEquityNode()" style="flex:1;padding:10px;border-radius:8px;border:none;background:#2563eb;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">保存</button>
        <button onclick="_closeEquityEdit()" style="flex:1;padding:10px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:14px;cursor:pointer;">取消</button>
      </div>
    </div>`;
  m.addEventListener('click', e => { if (e.target === m) _closeEquityEdit(); });
  document.body.appendChild(m);
}

function _editEquityNode(id) {
  _ensureEquityEditModal();
  _editingNid = id;
  const node = _equityNodeMap[id];
  document.getElementById('_eq_edit_name').value = node.name || '';
  document.getElementById('_eq_edit_value').value = node.value || '';
  const typeRow = document.getElementById('_eq_edit_type_row');
  if (node.type === 'target') {
    typeRow.style.display = 'none';
  } else {
    typeRow.style.display = 'block';
    document.getElementById('_eq_edit_type').value = node.type || 'company';
  }
  const modal = document.getElementById('_eq_edit_modal');
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('_eq_edit_name').focus(), 80);
}

function _closeEquityEdit() {
  const m = document.getElementById('_eq_edit_modal');
  if (m) m.style.display = 'none';
}

async function _saveEquityNode() {
  const node = _equityNodeMap[_editingNid];
  node.name  = document.getElementById('_eq_edit_name').value.trim();
  node.value = document.getElementById('_eq_edit_value').value.trim();
  if (node.type !== 'target') node.type = document.getElementById('_eq_edit_type').value;
  _closeEquityEdit();
  try {
    await apiFetch(`/api/companies/${currentCompanyId}/equity-data`, {
      method: 'PATCH', body: JSON.stringify({ data: _equityData }),
    });
  } catch (_) {}
  const inner = document.getElementById('equity-inner');
  if (inner && _equityData) _renderEquityChart(inner, _equityData);
}

// ── Boot ──────────────────────────────────────────────────────────────────────

checkAuth();
