// ==================== IndexedDB Database Manager ====================
class BookmarkDB {
    constructor() {
        this.dbName = 'BookmarkManager';
        this.version = 1;
        this.storeName = 'bookmarks';
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains(this.storeName)) {
                    const objectStore = db.createObjectStore(this.storeName, {
                        keyPath: 'id',
                        autoIncrement: true
                    });

                    objectStore.createIndex('name', 'name', { unique: false });
                    objectStore.createIndex('url', 'url', { unique: false });
                    objectStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                    objectStore.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    async add(bookmark) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            // Format date as: 年-月-日 时:分
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}`;

            const bookmarkData = {
                name: bookmark.name,
                url: bookmark.url,
                tags: bookmark.tags || [],
                createdAt: formattedDate
            };

            const request = objectStore.add(bookmarkData);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async update(id, bookmark) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);

            const getRequest = objectStore.get(id);

            getRequest.onsuccess = () => {
                const data = getRequest.result;
                if (data) {
                    data.name = bookmark.name;
                    data.url = bookmark.url;
                    data.tags = bookmark.tags || [];

                    const updateRequest = objectStore.put(data);
                    updateRequest.onsuccess = () => resolve(updateRequest.result);
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    reject(new Error('Bookmark not found'));
                }
            };

            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async delete(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readwrite');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getAll() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async get(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([this.storeName], 'readonly');
            const objectStore = transaction.objectStore(this.storeName);
            const request = objectStore.get(id);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async search(query) {
        const allBookmarks = await this.getAll();
        const searchTerm = query.toLowerCase().trim();

        if (!searchTerm) {
            return allBookmarks;
        }

        return allBookmarks.filter(bookmark => {
            const nameMatch = bookmark.name.toLowerCase().includes(searchTerm);
            const urlMatch = bookmark.url.toLowerCase().includes(searchTerm);
            const tagsMatch = bookmark.tags.some(tag =>
                tag.toLowerCase().includes(searchTerm)
            );

            return nameMatch || urlMatch || tagsMatch;
        });
    }
}

// ==================== Application Manager ====================
class BookmarkApp {
    constructor() {
        this.db = new BookmarkDB();
        this.currentPage = 1;
        this.itemsPerPage = 12;
        this.allBookmarks = [];
        this.filteredBookmarks = [];
        this.currentEditId = null;
        this.deleteTargetId = null;

        this.init();
    }

    async init() {
        try {
            await this.db.init();
            this.bindEvents();
            await this.loadBookmarks();
            this.hideLoading();
        } catch (error) {
            console.error('Initialization error:', error);
            this.showToast('初始化失败，请刷新页面重试', 'error');
            this.hideLoading();
        }
    }

    bindEvents() {
        // Search
        document.getElementById('searchBtn').addEventListener('click', () => this.handleSearch());
        document.getElementById('searchInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleSearch();
        });

        // Clear search on empty input
        document.getElementById('searchInput').addEventListener('input', (e) => {
            if (e.target.value === '') {
                this.handleSearch();
            }
        });

        // Add bookmark
        document.getElementById('addBtn').addEventListener('click', () => this.showAddModal());

        // Export
        document.getElementById('exportBtn').addEventListener('click', () => this.exportToExcel());

        // Modal controls
        document.getElementById('modalClose').addEventListener('click', () => this.closeModal());
        document.getElementById('cancelBtn').addEventListener('click', () => this.closeModal());
        document.querySelector('.modal-overlay').addEventListener('click', () => this.closeModal());

        // Form submit
        document.getElementById('bookmarkForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleFormSubmit();
        });

        // Delete modal
        document.getElementById('cancelDeleteBtn').addEventListener('click', () => this.closeDeleteModal());
        document.getElementById('confirmDeleteBtn').addEventListener('click', () => this.confirmDelete());
        document.querySelectorAll('#deleteModal .modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => this.closeDeleteModal());
        });

        // ESC key to close modals
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeModal();
                this.closeDeleteModal();
            }
        });
    }

    async loadBookmarks(searchQuery = '') {
        try {
            if (searchQuery) {
                this.filteredBookmarks = await this.db.search(searchQuery);
            } else {
                this.allBookmarks = await this.db.getAll();
                this.filteredBookmarks = [...this.allBookmarks];
            }

            // Sort by creation date (newest first)
            this.filteredBookmarks.sort((a, b) =>
                new Date(b.createdAt) - new Date(a.createdAt)
            );

            this.currentPage = 1;
            this.render();
        } catch (error) {
            console.error('Load bookmarks error:', error);
            this.showToast('加载失败', 'error');
        }
    }

    render() {
        this.renderBookmarks();
        this.renderPagination();
        this.updateStats();
    }

    renderBookmarks() {
        const container = document.getElementById('bookmarksContainer');
        const emptyState = document.getElementById('emptyState');

        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const pageBookmarks = this.filteredBookmarks.slice(startIndex, endIndex);

        if (this.filteredBookmarks.length === 0) {
            container.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        container.innerHTML = pageBookmarks.map(bookmark => this.createBookmarkCard(bookmark)).join('');

        // Bind card events
        container.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                this.showEditModal(id);
            });
        });

        container.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = parseInt(btn.dataset.id);
                this.showDeleteModal(id);
            });
        });
    }

    createBookmarkCard(bookmark) {
        const initial = bookmark.name.charAt(0).toUpperCase();
        const formattedDate = this.formatDate(bookmark.createdAt);
        const tagsHtml = bookmark.tags.map(tag =>
            `<span class="tag">${this.escapeHtml(tag)}</span>`
        ).join('');

        return `
            <div class="bookmark-card">
                <div class="bookmark-header">
                    <div class="bookmark-favicon">${initial}</div>
                    <div class="bookmark-info">
                        <h3 class="bookmark-name">${this.escapeHtml(bookmark.name)}</h3>
                        <a href="${this.escapeHtml(bookmark.url)}"
                           class="bookmark-url"
                           target="_blank"
                           rel="noopener noreferrer"
                           title="${this.escapeHtml(bookmark.url)}">
                            ${this.escapeHtml(this.truncateUrl(bookmark.url))}
                        </a>
                    </div>
                </div>
                ${bookmark.tags.length > 0 ? `<div class="bookmark-tags">${tagsHtml}</div>` : ''}
                <div class="bookmark-date">${formattedDate}</div>
                <div class="bookmark-actions">
                    <button class="icon-btn edit-btn" data-id="${bookmark.id}" title="编辑">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="icon-btn delete-btn delete" data-id="${bookmark.id}" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    renderPagination() {
        const pagination = document.getElementById('pagination');
        const totalPages = Math.ceil(this.filteredBookmarks.length / this.itemsPerPage);

        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let html = '';

        // Previous button
        html += `
            <button class="page-btn" ${this.currentPage === 1 ? 'disabled' : ''}
                    onclick="app.goToPage(${this.currentPage - 1})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"></polyline>
                </svg>
            </button>
        `;

        // Page numbers with ellipsis
        const pages = this.getPageNumbers(totalPages);
        pages.forEach(page => {
            if (page === '...') {
                html += `<span class="page-ellipsis">...</span>`;
            } else {
                html += `
                    <button class="page-btn ${page === this.currentPage ? 'active' : ''}"
                            onclick="app.goToPage(${page})">
                        ${page}
                    </button>
                `;
            }
        });

        // Next button
        html += `
            <button class="page-btn" ${this.currentPage === totalPages ? 'disabled' : ''}
                    onclick="app.goToPage(${this.currentPage + 1})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                </svg>
            </button>
        `;

        pagination.innerHTML = html;
    }

    getPageNumbers(totalPages) {
        const pages = [];
        const current = this.currentPage;

        if (totalPages <= 7) {
            for (let i = 1; i <= totalPages; i++) {
                pages.push(i);
            }
        } else {
            if (current <= 3) {
                for (let i = 1; i <= 4; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            } else if (current >= totalPages - 2) {
                pages.push(1);
                pages.push('...');
                for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push('...');
                for (let i = current - 1; i <= current + 1; i++) pages.push(i);
                pages.push('...');
                pages.push(totalPages);
            }
        }

        return pages;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredBookmarks.length / this.itemsPerPage);
        if (page < 1 || page > totalPages) return;

        this.currentPage = page;
        this.renderBookmarks();
        this.renderPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    updateStats() {
        document.getElementById('totalCount').textContent = this.allBookmarks.length;
        document.getElementById('displayCount').textContent = this.filteredBookmarks.length;
    }

    // ==================== Modal Management ====================
    showAddModal() {
        this.currentEditId = null;
        document.getElementById('modalTitle').textContent = '添加网址';
        document.getElementById('bookmarkForm').reset();
        document.getElementById('bookmarkId').value = '';
        document.getElementById('dateDisplay').style.display = 'none';
        this.openModal();
    }

    async showEditModal(id) {
        try {
            const bookmark = await this.db.get(id);
            if (!bookmark) {
                this.showToast('找不到该收藏', 'error');
                return;
            }

            this.currentEditId = id;
            document.getElementById('modalTitle').textContent = '编辑网址';
            document.getElementById('bookmarkId').value = id;
            document.getElementById('bookmarkName').value = bookmark.name;
            document.getElementById('bookmarkUrl').value = bookmark.url;
            // Use Chinese comma to separate tags
            document.getElementById('bookmarkTags').value = bookmark.tags.join('，');
            document.getElementById('bookmarkDate').value = bookmark.createdAt;
            document.getElementById('dateDisplay').style.display = 'block';
            this.openModal();
        } catch (error) {
            console.error('Show edit modal error:', error);
            this.showToast('加载失败', 'error');
        }
    }

    openModal() {
        document.getElementById('modal').classList.add('active');
        document.body.style.overflow = 'hidden';
        // Focus first input
        setTimeout(() => {
            document.getElementById('bookmarkName').focus();
        }, 100);
    }

    closeModal() {
        document.getElementById('modal').classList.remove('active');
        document.body.style.overflow = '';
        this.currentEditId = null;
    }

    showDeleteModal(id) {
        this.deleteTargetId = id;
        document.getElementById('deleteModal').classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeDeleteModal() {
        document.getElementById('deleteModal').classList.remove('active');
        document.body.style.overflow = '';
        this.deleteTargetId = null;
    }

    // ==================== CRUD Operations ====================
    async handleFormSubmit() {
        const name = document.getElementById('bookmarkName').value.trim();
        const url = document.getElementById('bookmarkUrl').value.trim();
        const tagsInput = document.getElementById('bookmarkTags').value.trim();

        if (!name || !url) {
            this.showToast('请填写必填项', 'error');
            return;
        }

        // Validate URL
        try {
            new URL(url);
        } catch {
            this.showToast('请输入有效的网址', 'error');
            return;
        }

        // Parse and process tags: convert English commas to Chinese commas, remove spaces and duplicates
        let tags = [];
        if (tagsInput) {
            // Split by various separators
            tags = tagsInput.split(/[,;，；\s]+/)
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);

            // Remove duplicates (case-insensitive)
            const uniqueTags = [];
            const lowerCaseTags = new Set();
            for (const tag of tags) {
                const lowerTag = tag.toLowerCase();
                if (!lowerCaseTags.has(lowerTag)) {
                    lowerCaseTags.add(lowerTag);
                    uniqueTags.push(tag);
                }
            }
            tags = uniqueTags;
        }

        const bookmark = { name, url, tags };

        try {
            if (this.currentEditId) {
                await this.db.update(this.currentEditId, bookmark);
                this.showToast('更新成功', 'success');
            } else {
                await this.db.add(bookmark);
                this.showToast('添加成功', 'success');
            }

            this.closeModal();
            await this.loadBookmarks(document.getElementById('searchInput').value);
        } catch (error) {
            console.error('Save error:', error);
            this.showToast('保存失败', 'error');
        }
    }

    async confirmDelete() {
        if (!this.deleteTargetId) return;

        try {
            await this.db.delete(this.deleteTargetId);
            this.showToast('删除成功', 'success');
            this.closeDeleteModal();
            await this.loadBookmarks(document.getElementById('searchInput').value);
        } catch (error) {
            console.error('Delete error:', error);
            this.showToast('删除失败', 'error');
        }
    }

    // ==================== Search ====================
    async handleSearch() {
        const query = document.getElementById('searchInput').value.trim();
        await this.loadBookmarks(query);
    }

    // ==================== Export to Excel ====================
    async exportToExcel() {
        try {
            const bookmarks = await this.db.getAll();

            if (bookmarks.length === 0) {
                this.showToast('没有数据可导出', 'error');
                return;
            }

            // Sort by creation date
            bookmarks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Create CSV content
            const headers = ['ID', '网站名称', '网址', '分类标签', '创建日期'];
            const rows = bookmarks.map(b => [
                b.id,
                b.name,
                b.url,
                b.tags.join('，'),
                b.createdAt
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            ].join('\n');

            // Add BOM for Excel UTF-8 support
            const BOM = '\uFEFF';
            const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });

            // Download
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            const timestamp = new Date().toISOString().slice(0, 10);

            link.setAttribute('href', url);
            link.setAttribute('download', `网站收藏_${timestamp}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            this.showToast('导出成功', 'success');
        } catch (error) {
            console.error('Export error:', error);
            this.showToast('导出失败', 'error');
        }
    }

    // ==================== Utilities ====================
    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) return '今天';
        if (days === 1) return '昨天';
        if (days < 7) return `${days}天前`;
        if (days < 30) return `${Math.floor(days / 7)}周前`;
        if (days < 365) return `${Math.floor(days / 30)}个月前`;

        return date.toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    truncateUrl(url) {
        try {
            const urlObj = new URL(url);
            let display = urlObj.hostname + urlObj.pathname;
            if (display.length > 50) {
                display = display.substring(0, 47) + '...';
            }
            return display;
        } catch {
            return url.length > 50 ? url.substring(0, 47) + '...' : url;
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = `toast show ${type}`;

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    hideLoading() {
        document.getElementById('loadingState').style.display = 'none';
    }
}

// ==================== Initialize App ====================
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new BookmarkApp();
});
