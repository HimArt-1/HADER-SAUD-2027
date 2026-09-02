/**
 * whattONE v2 Dashboard — Client Logic
 * Import, Templates, Queue, Settings
 */

const API = window.location.origin;
let importFilePath = null;
let currentQueueFilter = 'all';
let allQueueItems = [];
let editingTemplateId = null;

// ═══════════════════════════════════════
// 🔄 Status Polling
// ═══════════════════════════════════════

async function fetchStatus() {
    try {
        const res = await fetch(`${API}/api/status`);
        const data = await res.json();
        updateStatusUI(data);
    } catch (err) {
        updateStatusUI({ running: false, state: 'offline', state_message: 'الخادم غير متصل', stats: {} });
    }
}

function updateStatusUI(data) {
    const badge = document.getElementById('statusBadge');
    const dotText = badge.querySelector('.status-text');
    const btnStart = document.getElementById('btnStart');
    const btnStop = document.getElementById('btnStop');
    const stateMsg = document.getElementById('stateMessage');

    badge.className = 'status-badge';
    const isActive = ['initializing', 'waiting_login', 'running'].includes(data.state);
    if (data.state === 'running') { badge.classList.add('online'); dotText.textContent = 'يعمل'; }
    else if (data.state === 'error') { badge.classList.add('error'); dotText.textContent = 'خطأ'; }
    else if (isActive) { badge.classList.add('online'); dotText.textContent = 'جاري التشغيل...'; }
    else if (data.state === 'offline') { dotText.textContent = 'غير متصل'; }
    else { dotText.textContent = 'متوقف'; }

    btnStart.disabled = isActive;
    btnStop.disabled = !isActive;
    stateMsg.textContent = data.state_message || 'في وضع الانتظار';

    const s = data.stats || {};
    document.getElementById('statSent').textContent = s.sent || 0;
    document.getElementById('statFailed').textContent = s.failed || 0;
    document.getElementById('statTotal').textContent = s.total || 0;
    document.getElementById('statPending').textContent = Math.max(0, (s.total || 0) - (s.sent || 0) - (s.failed || 0) - (s.skipped || 0));
}

// ═══════════════════════════════════════
// 🎮 Bot Controls
// ═══════════════════════════════════════

async function startBot() {
    try {
        const res = await fetch(`${API}/api/start`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message, res.ok ? 'success' : 'error');
        fetchStatus();
    } catch (err) { showToast('فشل الاتصال', 'error'); }
}

async function stopBot() {
    try {
        const res = await fetch(`${API}/api/stop`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message, res.ok ? 'success' : 'error');
        fetchStatus();
    } catch (err) { showToast('فشل الاتصال', 'error'); }
}

async function clearQueue() {
    if (!confirm('هل تريد مسح جميع الرسائل؟')) return;
    try {
        const res = await fetch(`${API}/api/clear`, { method: 'POST' });
        const data = await res.json();
        showToast(data.message, res.ok ? 'success' : 'error');
        refreshQueue();
    } catch (err) { showToast('فشل', 'error'); }
}

// ═══════════════════════════════════════
// 📥 Smart Import
// ═══════════════════════════════════════

function setupImport() {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('importFileInput');

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleImportFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleImportFile(e.target.files[0]);
    });
}

async function handleImportFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
        showToast('يجب أن يكون الملف CSV أو Excel', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    showToast('جاري تحليل الملف...', 'info');

    try {
        const res = await fetch(`${API}/api/import/upload`, { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.message || 'فشل رفع الملف', 'error');
            return;
        }

        importFilePath = data.file_path;
        renderImportPreview(data);
    } catch (err) {
        showToast('فشل رفع الملف', 'error');
    }
}

function renderImportPreview(data) {
    document.getElementById('importZone').style.display = 'none';
    document.getElementById('importPreview').style.display = 'block';
    document.getElementById('importResult').style.display = 'none';

    // Info
    document.getElementById('previewInfo').textContent = `${data.total_rows || 0} سجل • ${data.columns?.length || 0} أعمدة`;

    // Column Mapping
    const mappingGrid = document.getElementById('mappingGrid');
    const mapping = data.detected_mapping || {};
    const labels = {
        student_name: '👤 اسم الطالب', phone: '📱 الهاتف', status: '📌 الحالة',
        grade: '🏫 الصف', section: '📋 الفصل', time: '🕐 الوقت',
        date: '📅 التاريخ', parent_name: '👨 ولي الأمر', notes: '📝 ملاحظات'
    };

    mappingGrid.innerHTML = Object.entries(labels).map(([key, label]) => {
        const col = mapping[key];
        if (col) {
            return `<div class="mapping-chip"><strong>${label}</strong> <span class="chip-label">← ${esc(col)}</span></div>`;
        }
        return `<div class="mapping-chip mapping-chip-unmapped">${label} <span class="chip-label">غير مكتشف</span></div>`;
    }).join('');

    // Table preview
    const thead = document.getElementById('previewHead');
    const tbody = document.getElementById('previewBody');

    if (data.columns && data.columns.length) {
        thead.innerHTML = '<tr>' + data.columns.map(c => `<th>${esc(c)}</th>`).join('') + '</tr>';
        tbody.innerHTML = (data.sample_rows || []).map(row =>
            '<tr>' + row.map(cell => `<td>${esc(cell || '')}</td>`).join('') + '</tr>'
        ).join('');
    }
}

async function processImport() {
    if (!importFilePath) {
        showToast('لم يتم رفع ملف', 'error');
        return;
    }

    showToast('جاري المعالجة...', 'info');

    // Get selected status override
    const statusRadio = document.querySelector('input[name="importStatus"]:checked');
    const statusOverride = statusRadio ? statusRadio.value : 'auto';

    try {
        const res = await fetch(`${API}/api/import/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_path: importFilePath, status_override: statusOverride })
        });
        const data = await res.json();

        if (!res.ok) {
            showToast(data.message || 'فشل المعالجة', 'error');
            return;
        }

        showToast(data.message, 'success');
        renderImportResult(data);
        refreshQueue();
    } catch (err) {
        showToast('فشل المعالجة', 'error');
    }
}

function renderImportResult(data) {
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('importResult').style.display = 'block';

    const s = data.stats || {};
    document.getElementById('resultTitle').textContent = `✅ تم استيراد ${s.queued || 0} رسالة`;
    document.getElementById('resultStats').innerHTML = `
        <div class="result-stat"><span class="rs-val" style="color:var(--info)">${s.total || 0}</span><span class="rs-label">إجمالي</span></div>
        <div class="result-stat"><span class="rs-val" style="color:var(--wa-green)">${s.valid || 0}</span><span class="rs-label">صالح</span></div>
        <div class="result-stat"><span class="rs-val" style="color:var(--danger)">${s.absent || 0}</span><span class="rs-label">🔴 غائب</span></div>
        <div class="result-stat"><span class="rs-val" style="color:var(--warning)">${s.late || 0}</span><span class="rs-label">🟡 متأخر</span></div>
        <div class="result-stat"><span class="rs-val" style="color:var(--orange)">${s.excused || 0}</span><span class="rs-label">🟠 مستأذن</span></div>
        <div class="result-stat"><span class="rs-val" style="color:var(--text-muted)">${s.invalid_phone || 0}</span><span class="rs-label">رقم خاطئ</span></div>
    `;
}

function resetImport() {
    importFilePath = null;
    document.getElementById('importZone').style.display = 'block';
    document.getElementById('importPreview').style.display = 'none';
    document.getElementById('importResult').style.display = 'none';
    document.getElementById('importFileInput').value = '';
}

// ═══════════════════════════════════════
// 📝 Templates
// ═══════════════════════════════════════

async function loadTemplates() {
    try {
        const res = await fetch(`${API}/api/templates`);
        const templates = await res.json();
        renderTemplates(templates);
    } catch (err) { console.error('Templates load failed', err); }
}

function renderTemplates(templates) {
    const grid = document.getElementById('templatesGrid');
    grid.innerHTML = templates.map(t => `
        <div class="template-card" onclick="editTemplate('${t.id}')">
            <div class="tc-emoji">${t.emoji || '📝'}</div>
            <div class="tc-name">${esc(t.name || t.id)}</div>
            <div class="tc-preview">${esc((t.message || '').substring(0, 100))}...</div>
            ${t.is_default ? '<span class="tc-badge">افتراضي</span>' : ''}
        </div>
    `).join('') + `
        <div class="template-card" onclick="newTemplate()" style="border-style:dashed;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div class="tc-emoji">➕</div>
            <div class="tc-name">إنشاء قالب جديد</div>
        </div>
    `;
}

async function editTemplate(id) {
    try {
        const res = await fetch(`${API}/api/templates/${id}`);
        const t = await res.json();
        editingTemplateId = id;
        document.getElementById('editorTitle').textContent = `✏️ تعديل: ${t.name}`;
        document.getElementById('tplName').value = t.name || '';
        document.getElementById('tplMessage').value = t.message || '';
        document.getElementById('templateEditor').style.display = 'block';
        document.getElementById('tplPreviewBox').style.display = 'none';
        loadPlaceholders();
    } catch (err) { showToast('فشل تحميل القالب', 'error'); }
}

function newTemplate() {
    editingTemplateId = null;
    document.getElementById('editorTitle').textContent = '➕ قالب جديد';
    document.getElementById('tplName').value = '';
    document.getElementById('tplMessage').value = '';
    document.getElementById('templateEditor').style.display = 'block';
    document.getElementById('tplPreviewBox').style.display = 'none';
    loadPlaceholders();
}

function closeEditor() {
    document.getElementById('templateEditor').style.display = 'none';
    editingTemplateId = null;
}

async function loadPlaceholders() {
    try {
        const res = await fetch(`${API}/api/placeholders`);
        const placeholders = await res.json();
        const bar = document.getElementById('placeholdersBar');
        bar.innerHTML = Object.entries(placeholders).map(([key, label]) =>
            `<span class="placeholder-tag" onclick="insertPlaceholder('${key}')">${key} — ${label}</span>`
        ).join('');
    } catch (err) { console.error(err); }
}

function insertPlaceholder(ph) {
    const textarea = document.getElementById('tplMessage');
    const pos = textarea.selectionStart;
    const text = textarea.value;
    textarea.value = text.substring(0, pos) + ph + text.substring(pos);
    textarea.focus();
    textarea.setSelectionRange(pos + ph.length, pos + ph.length);
}

async function saveTemplate() {
    const name = document.getElementById('tplName').value.trim();
    const message = document.getElementById('tplMessage').value.trim();
    if (!name || !message) { showToast('يرجى إدخال الاسم والنص', 'error'); return; }

    const payload = { name, message, emoji: '📝', category: 'custom' };
    let url, method;

    if (editingTemplateId) {
        url = `${API}/api/templates/${editingTemplateId}`;
        method = 'PUT';
    } else {
        payload.id = 'custom_' + Date.now();
        url = `${API}/api/templates`;
        method = 'POST';
    }

    try {
        const res = await fetch(url, {
            method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        const data = await res.json();
        showToast(data.message, res.ok ? 'success' : 'error');
        if (res.ok) { closeEditor(); loadTemplates(); }
    } catch (err) { showToast('فشل الحفظ', 'error'); }
}

async function previewTemplate() {
    const message = document.getElementById('tplMessage').value.trim();
    if (!message) return;

    try {
        const res = await fetch(`${API}/api/templates/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ template_id: editingTemplateId || 'absent' })
        });
        const data = await res.json();
        document.getElementById('tplPreviewBox').style.display = 'block';
        document.getElementById('tplPreviewText').textContent = data.message || '';
    } catch (err) { showToast('فشل المعاينة', 'error'); }
}

// ═══════════════════════════════════════
// ✍️ Compose
// ═══════════════════════════════════════

async function sendSingleMessage() {
    const phone = document.getElementById('phoneInput').value.trim();
    const name = document.getElementById('nameInput').value.trim();
    const grade = document.getElementById('gradeInput').value.trim();
    const section = document.getElementById('sectionInput').value.trim();
    const statusType = document.getElementById('statusSelect').value;
    let message = document.getElementById('messageInput').value.trim();

    if (!phone) { showToast('يرجى إدخال رقم الهاتف', 'error'); return; }

    // If no custom message, use template
    if (!message) {
        try {
            const res = await fetch(`${API}/api/templates/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template_id: statusType,
                    student_name: name || 'طالب',
                    grade: grade, section: section
                })
            });
            const data = await res.json();
            message = data.message;
        } catch (err) {
            showToast('فشل توليد الرسالة', 'error');
            return;
        }
    }

    const payload = [{
        phone, message,
        student_name: name,
        status_type: statusType,
        grade, section
    }];

    try {
        const res = await fetch(`${API}/api/send?append=true`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        showToast(data.message, res.ok ? 'success' : 'error');
        if (res.ok) {
            document.getElementById('phoneInput').value = '';
            document.getElementById('nameInput').value = '';
            document.getElementById('messageInput').value = '';
            refreshQueue();
        }
    } catch (err) { showToast('فشل الإرسال', 'error'); }
}

// ═══════════════════════════════════════
// 📨 Queue
// ═══════════════════════════════════════

async function refreshQueue() {
    try {
        const res = await fetch(`${API}/api/queue`);
        allQueueItems = await res.json();
        renderQueue();
    } catch (err) { console.error(err); }
}

function filterQueue(filter) {
    currentQueueFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
    renderQueue();
}

function renderQueue() {
    const filtered = currentQueueFilter === 'all' ? allQueueItems :
        allQueueItems.filter(i => (i.status || 'pending') === currentQueueFilter);

    document.getElementById('queueCount').textContent = `${filtered.length} من ${allQueueItems.length}`;
    const container = document.getElementById('queueList');

    if (!filtered.length) {
        container.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>لا توجد رسائل</p></div>';
        return;
    }

    container.innerHTML = filtered.map(item => {
        const statusEmoji = { pending: '⏳', sent: '✅', failed: '❌', skipped: '⏭', invalid_phone: '📵' };
        const statusText = { pending: 'انتظار', sent: 'تم', failed: 'فشل', skipped: 'تخطي', invalid_phone: 'رقم خاطئ' };
        const st = item.status || 'pending';
        const msgHtml = esc(item.message || '').replace(/\n/g, '<br>');
        return `
        <div class="queue-item" onclick="this.classList.toggle('expanded')">
            <div class="queue-item-info">
                <div class="queue-item-top">
                    <span class="queue-name">${esc(item.student_name || '')}</span>
                    <span class="queue-phone">${esc(item.phone || '')}</span>
                    <span class="queue-status ${st}">${statusEmoji[st] || '⏳'} ${statusText[st] || st}</span>
                </div>
                <div class="queue-message-preview">${esc((item.message || '').split('\\n').slice(0, 2).join(' • '))}</div>
                <div class="queue-message-full">${msgHtml}</div>
            </div>
            <button class="queue-delete" onclick="event.stopPropagation(); deleteMessage('${item.id}')" title="حذف">🗑</button>
        </div>`;
    }).join('');
}

async function deleteMessage(id) {
    try {
        await fetch(`${API}/api/queue/${id}`, { method: 'DELETE' });
        refreshQueue();
    } catch (err) { showToast('فشل', 'error'); }
}

// ═══════════════════════════════════════
// ⚙️ Settings
// ═══════════════════════════════════════

async function loadSettings() {
    try {
        const res = await fetch(`${API}/api/settings`);
        const s = await res.json();
        document.getElementById('setSchoolName').value = s.school_name || '';
        document.getElementById('setBatchSize').value = s.batch_size || 5;
        document.getElementById('setLongBreak').value = s.long_break || 60;
        document.getElementById('setMinDelay').value = s.min_delay || 5;
        document.getElementById('setMaxDelay').value = s.max_delay || 15;
        document.getElementById('setNotifyPresent').checked = s.notify_present || false;
    } catch (err) { console.error(err); }
}

async function saveSettings() {
    const settings = {
        school_name: document.getElementById('setSchoolName').value.trim(),
        batch_size: parseInt(document.getElementById('setBatchSize').value) || 5,
        long_break: parseInt(document.getElementById('setLongBreak').value) || 60,
        min_delay: parseInt(document.getElementById('setMinDelay').value) || 5,
        max_delay: parseInt(document.getElementById('setMaxDelay').value) || 15,
        notify_present: document.getElementById('setNotifyPresent').checked
    };
    try {
        const res = await fetch(`${API}/api/settings`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings)
        });
        const data = await res.json();
        showToast(data.message, res.ok ? 'success' : 'error');
    } catch (err) { showToast('فشل الحفظ', 'error'); }
}

// ═══════════════════════════════════════
// 📜 Logs
// ═══════════════════════════════════════

async function refreshLogs() {
    try {
        const res = await fetch(`${API}/api/logs`);
        const data = await res.json();
        const container = document.getElementById('logsContainer');
        const lines = data.logs || [];
        if (!lines.length) {
            container.innerHTML = '<div class="empty-state"><span class="empty-icon">📃</span><p>لا توجد سجلات</p></div>';
            return;
        }
        container.innerHTML = lines.map(l => {
            let cls = '';
            if (l.includes('[ERROR]')) cls = 'log-error';
            else if (l.includes('[WARNING]')) cls = 'log-warn';
            else if (l.includes('[INFO]')) cls = 'log-info';
            return `<div class="log-line"><span class="${cls}">${esc(l.trim())}</span></div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    } catch (err) { console.error(err); }
}

// ═══════════════════════════════════════
// 🗂 Tabs
// ═══════════════════════════════════════

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');

    if (tabId === 'queue') refreshQueue();
    if (tabId === 'logs') refreshLogs();
    if (tabId === 'templates') loadTemplates();
    if (tabId === 'settings') loadSettings();
}

// ═══════════════════════════════════════
// 🔧 Utils
// ═══════════════════════════════════════

function esc(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function showToast(message, type = 'info') {
    const c = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 3000);
}

// ═══════════════════════════════════════
// 🚀 Init
// ═══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
    setInterval(fetchStatus, 3000);
    setupImport();
    loadTemplates();
    loadSettings();
    refreshQueue();
});
