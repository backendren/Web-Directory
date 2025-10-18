/* App: Website Bookmark Manager - Pure HTML/CSS/JS + IndexedDB */
(function() {
  'use strict';

  // Constants
  const DB_NAME = 'bookmark_manager_db';
  const DB_VERSION = 1;
  const STORE = 'bookmarks';
  const PAGE_SIZE = 12;

  // State
  const state = {
    db: null,
    items: [], // all items fetched (filtered by search)
    total: 0,
    page: 1,
    keyword: '',
    deletingId: null,
    editing: null,
  };

  // Utilities
  function fmtDate(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hh = pad(d.getHours());
    const mm = pad(d.getMinutes());
    return `${year}-${month}-${day} ${hh}:${mm}`;
  }

  function isValidUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function parseTags(input) {
    if (!input) return [];
    return input
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  function debounce(fn, wait) {
    let t = null;
    return function(...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // IndexedDB helpers
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(storeName, mode = 'readonly') {
    const t = state.db.transaction(storeName, mode);
    return t.objectStore(storeName);
  }

  function addBookmark(data) {
    return new Promise((resolve, reject) => {
      const store = tx(STORE, 'readwrite');
      const req = store.add(data);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function updateBookmark(id, data) {
    return new Promise((resolve, reject) => {
      const store = tx(STORE, 'readwrite');
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const val = getReq.result;
        if (!val) { reject(new Error('Not found')); return; }
        const next = { ...val, ...data, id };
        const putReq = store.put(next);
        putReq.onsuccess = () => resolve(true);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  function deleteBookmark(id) {
    return new Promise((resolve, reject) => {
      const store = tx(STORE, 'readwrite');
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  function getAllBookmarks() {
    return new Promise((resolve, reject) => {
      const store = tx(STORE, 'readonly');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // Search (client-side LIKE: url, name, tags)
  function matchesKeyword(item, kw) {
    if (!kw) return true;
    const s = kw.toLowerCase();
    const name = (item.name || '').toLowerCase();
    const url = (item.url || '').toLowerCase();
    const tags = (item.tags || []).join(',').toLowerCase();
    return name.includes(s) || url.includes(s) || tags.includes(s);
  }

  // Rendering
  const el = {
    year: null,
    searchInput: null,
    searchBtn: null,
    addBtn: null,
    exportBtn: null,
    emptyState: null,
    emptyAddBtn: null,
    listGrid: null,
    pagination: null,
    modalAddEdit: null,
    addEditForm: null,
    createdAtField: null,
    idField: null,
    f_id: null, f_id_display: null, f_url: null, f_name: null, f_tags: null, f_createdAt: null,
    modalConfirm: null,
    confirmDeleteBtn: null,
  };

  function qs(id) { return document.getElementById(id); }

  function cacheElements() {
    el.year = qs('year');
    el.searchInput = qs('searchInput');
    el.searchBtn = qs('searchBtn');
    el.addBtn = qs('addBtn');
    el.exportBtn = qs('exportBtn');
    el.emptyState = qs('emptyState');
    el.emptyAddBtn = qs('emptyAddBtn');
    el.listGrid = qs('listGrid');
    el.pagination = qs('pagination');
    el.modalAddEdit = qs('modalAddEdit');
    el.addEditForm = qs('addEditForm');
    el.createdAtField = qs('createdAtField');
    el.idField = qs('idField');
    el.f_id = qs('f_id');
    el.f_id_display = qs('f_id_display');
    el.f_url = qs('f_url');
    el.f_name = qs('f_name');
    el.f_tags = qs('f_tags');
    el.f_createdAt = qs('f_createdAt');
    el.modalConfirm = qs('modalConfirm');
    el.confirmDeleteBtn = qs('confirmDeleteBtn');
  }

  function setYear() {
    el.year.textContent = String(new Date().getFullYear());
  }

  function getFaviconChar(name, url) {
    const from = (name || url || '').trim();
    if (!from) return '🔗';
    const ch = from.replace(/https?:\/\//,'').trim()[0] || '🔗';
    return ch.toUpperCase();
  }

  function renderList() {
    const items = state.items;
    const total = items.length;
    state.total = total;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;
    const start = (state.page - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    // Empty state
    el.emptyState.classList.toggle('hidden', total !== 0);

    // Cards
    el.listGrid.innerHTML = slice.map(item => {
      const tagHtml = (item.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
      const favicon = escapeHtml(getFaviconChar(item.name, item.url));
      return `
        <article class="card" role="listitem" data-id="${item.id}">
          <div class="actions">
            <button class="action-btn" data-action="edit" title="编辑">✏️</button>
            <button class="action-btn" data-action="delete" title="删除">🗑️</button>
          </div>
          <div class="row">
            <div class="favicon">${favicon}</div>
            <h4 class="name">${escapeHtml(item.name || '')}</h4>
          </div>
          <div class="url" title="${escapeHtml(item.url)}"><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.url)}</a></div>
          <div class="tags">${tagHtml}</div>
          <div class="meta">添加于：${escapeHtml(item.createdAt || '')}</div>
        </article>
      `;
    }).join('');

    // Delegated actions
    el.listGrid.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', onCardActionClick);
    });

    // Pagination
    renderPagination(pages);
  }

  function renderPagination(pages) {
    const page = state.page;
    if (pages <= 1) { el.pagination.innerHTML = ''; return; }
    const btn = (p, label = p, active = false) => `
      <button class="page-btn ${active ? 'active' : ''}" data-page="${p}">${label}</button>
    `;
    const parts = [];
    parts.push(btn(Math.max(1, page - 1), '‹'));

    const windowSize = 5;
    const start = Math.max(1, page - Math.floor(windowSize/2));
    const end = Math.min(pages, start + windowSize - 1);
    const realStart = Math.max(1, end - windowSize + 1);
    for (let p = realStart; p <= end; p++) parts.push(btn(p, String(p), p === page));

    parts.push(btn(Math.min(pages, page + 1), '›'));
    el.pagination.innerHTML = parts.join('');
    el.pagination.querySelectorAll('.page-btn').forEach(b => b.addEventListener('click', onPageClick));
  }

  function onPageClick(e) {
    const p = Number(e.currentTarget.getAttribute('data-page'));
    if (!Number.isFinite(p)) return;
    state.page = p;
    renderList();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  // Data pipeline
  async function refreshList() {
    const all = await getAllBookmarks();
    const filtered = state.keyword ? all.filter(x => matchesKeyword(x, state.keyword)) : all;
    // Sort by createdAt desc
    filtered.sort((a, b) => {
      const da = new Date(a.createdAt || 0).getTime();
      const db = new Date(b.createdAt || 0).getTime();
      return db - da;
    });
    state.items = filtered;
    renderList();
  }

  // Modals
  function openModal(modal) { modal.classList.remove('hidden'); }
  function closeModal(modal) { modal.classList.add('hidden'); }

  function resetForm() {
    el.f_id.value = '';
    if (el.f_id_display) el.f_id_display.value = '';
    el.f_url.value = '';
    el.f_name.value = '';
    el.f_tags.value = '';
    el.f_createdAt.value = '';
    el.createdAtField.hidden = true;
    if (el.idField) el.idField.hidden = true;
    el.addEditForm.dataset.mode = 'add';
    qs('modalAddEditTitle').textContent = '添加网址';
  }

  function fillFormForEdit(item) {
    el.f_id.value = item.id;
    if (el.f_id_display) el.f_id_display.value = String(item.id);
    el.f_url.value = item.url || '';
    el.f_name.value = item.name || '';
    el.f_tags.value = (item.tags || []).join(', ');
    el.f_createdAt.value = item.createdAt || '';
    el.createdAtField.hidden = false;
    if (el.idField) el.idField.hidden = false;
    el.addEditForm.dataset.mode = 'edit';
    qs('modalAddEditTitle').textContent = '编辑网址';
  }

  function onCardActionClick(e) {
    const btn = e.currentTarget;
    const card = btn.closest('.card');
    const id = Number(card.getAttribute('data-id'));
    const action = btn.getAttribute('data-action');
    if (action === 'edit') {
      const item = state.items.find(x => x.id === id);
      if (!item) return;
      fillFormForEdit(item);
      openModal(el.modalAddEdit);
    } else if (action === 'delete') {
      state.deletingId = id;
      openModal(el.modalConfirm);
    }
  }

  // Add/Edit submit
  async function onFormSubmit(e) {
    e.preventDefault();
    const mode = el.addEditForm.dataset.mode;
    const url = el.f_url.value.trim();
    const name = el.f_name.value.trim();
    const tags = parseTags(el.f_tags.value);
    const createdAt = el.f_createdAt.value.trim();

    if (!isValidUrl(url)) {
      el.f_url.focus();
      el.f_url.setCustomValidity('请输入合法的网址 (http/https)');
      el.f_url.reportValidity();
      return;
    } else {
      el.f_url.setCustomValidity('');
    }

    if (!name) {
      el.f_name.focus();
      el.f_name.setCustomValidity('请输入网站名称');
      el.f_name.reportValidity();
      return;
    } else {
      el.f_name.setCustomValidity('');
    }

    try {
      if (mode === 'add') {
        const now = new Date();
        const item = { name, url, tags, createdAt: fmtDate(now) };
        await addBookmark(item);
      } else {
        const id = Number(el.f_id.value);
        const data = { name, url, tags };
        // allow editing createdAt if provided, otherwise keep
        if (createdAt) data.createdAt = createdAt;
        await updateBookmark(id, data);
      }
      closeModal(el.modalAddEdit);
      resetForm();
      await refreshList();
    } catch (err) {
      console.error(err);
      alert('保存失败，请重试');
    }
  }

  // Delete confirm
  async function onConfirmDelete() {
    if (!state.deletingId) { closeModal(el.modalConfirm); return; }
    try {
      await deleteBookmark(state.deletingId);
      state.deletingId = null;
      closeModal(el.modalConfirm);
      await refreshList();
    } catch (err) {
      console.error(err);
      alert('删除失败，请重试');
    }
  }

  // Search handlers
  function onSearch() {
    state.keyword = el.searchInput.value.trim();
    state.page = 1;
    refreshList();
  }

  function onEnterSearch(e) {
    if (e.key === 'Enter') { onSearch(); }
  }

  // Export to Excel
  async function exportToExcel() {
    const all = await getAllBookmarks();
    const rows = all.map(item => ({
      ID: item.id,
      网站名称: item.name || '',
      网址: item.url || '',
      分类标签: (item.tags || []).join(', '),
      创建日期: item.createdAt || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '收藏');
    XLSX.writeFile(wb, '我的收藏.xlsx');
  }

  // Global events
  function bindEvents() {
    // header actions
    el.searchBtn.addEventListener('click', onSearch);
    el.searchInput.addEventListener('keydown', onEnterSearch);
    el.searchInput.addEventListener('input', debounce(onSearch, 300));

    el.addBtn.addEventListener('click', () => { resetForm(); openModal(el.modalAddEdit); setTimeout(() => el.f_url.focus(), 0); });
    el.exportBtn.addEventListener('click', exportToExcel);

    // empty state CTA
    el.emptyAddBtn.addEventListener('click', () => { resetForm(); openModal(el.modalAddEdit); setTimeout(() => el.f_url.focus(), 0); });

    // modal close (backdrop and close buttons)
    document.body.addEventListener('click', (e) => {
      const t = e.target;
      if (t.matches('[data-close="modal"]')) {
        const modal = t.closest('.modal');
        if (modal) closeModal(modal);
      }
    });

    // form submit
    el.addEditForm.addEventListener('submit', onFormSubmit);

    // confirm delete
    el.confirmDeleteBtn.addEventListener('click', onConfirmDelete);

    // open link in new tab via anchor already set; also allow click on card opens link
    el.listGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const isAction = e.target.closest('.action-btn');
      if (isAction) return; // handled separately
      const id = Number(card.getAttribute('data-id'));
      const item = state.items.find(x => x.id === id);
      if (item && item.url) {
        window.open(item.url, '_blank', 'noopener');
      }
    });

    // ESC to close modals
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        [el.modalAddEdit, el.modalConfirm].forEach(m => { if (!m.classList.contains('hidden')) closeModal(m); });
      }
    });
  }

  // Boot
  async function boot() {
    cacheElements();
    setYear();
    bindEvents();
    try {
      state.db = await openDB();
      await refreshList();
    } catch (err) {
      console.error(err);
      alert('初始化数据库失败。请检查浏览器是否支持 IndexedDB。');
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
