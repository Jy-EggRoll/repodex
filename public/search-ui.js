
const queryInput = document.getElementById('queryInput');
const searchLoading = document.getElementById('searchLoading');
const searchError = document.getElementById('searchError');
const resultsEl = document.getElementById('results');
const fileCheckboxes = document.getElementById('fileCheckboxes');
const modeToggle = document.getElementById('modeToggle');
const searchBtn = document.getElementById('searchBtn');
let cachedIndexArr = null;

function searchShowLoading() { if (searchLoading) searchLoading.classList.remove('hidden'); }
function searchHideLoading() { if (searchLoading) searchLoading.classList.add('hidden'); }
function searchBtnShowLoading() {
    if (!searchBtn) return;
    searchBtn.disabled = true;

    searchBtn.innerHTML = '<span class="loading loading-spinner mx-auto"></span>';
}
function searchBtnHideLoading() {
    if (!searchBtn) return;
    searchBtn.disabled = false;
    searchBtn.innerHTML = '<span class="mx-auto">搜索</span>';
}
function searchShowError(msg) { searchError.textContent = msg; searchError.classList.remove('hidden'); }
function searchHideError() { searchError.textContent = ''; searchError.classList.add('hidden'); }

let searchTimer = 0;
if (queryInput) {
    queryInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => doSearch(), 300);
    });
}


searchBtn?.addEventListener('click', () => doSearch());


modeToggle?.addEventListener('change', () => doSearch());

async function loadIndexList() {
    if (!fileCheckboxes) return;
    try {

        const openBtn = document.getElementById('openIndexModalBtn');
        if (openBtn) {
            openBtn.disabled = true;
            openBtn.classList.add('loading');
            const cntSpan = document.getElementById('indexSelectedCount');
            if (cntSpan) cntSpan.textContent = '(请求索引中)';
        }
        let arr;
        if (cachedIndexArr) {
            arr = cachedIndexArr;
        } else {
            const res = await fetch('/api/repo-list');
            if (!res.ok) return;
            arr = await res.json();
            cachedIndexArr = arr;
        }
        fileCheckboxes.innerHTML = '';
        const allWrap = document.createElement('div');
        allWrap.className = 'mb-2';
        allWrap.innerHTML = `
            <label class="flex items-center gap-2">
                <input type="checkbox" id="_all_index_checkbox" checked class="checkbox checkbox-sm" />
                <span class="text-sm">全部索引</span>
            </label>
        `;
        fileCheckboxes.appendChild(allWrap);

        const listWrap = document.createElement('div');
        arr.forEach(fname => {
            const id = `chk_${fname.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
            const div = document.createElement('div');
            div.className = 'mb-1';
            div.innerHTML = `
                <label class="flex items-center gap-2">
                    <input type="checkbox" class="index-checkbox checkbox checkbox-sm" id="${id}" value="${fname}" checked />
                    <span class="text-sm break-all">${fname}</span>
                </label>
            `;
            listWrap.appendChild(div);
        });
        fileCheckboxes.appendChild(listWrap);


        const cntEl = document.getElementById('indexSelectedCount');
        function updateIndexSelectedCount() {
            if (!cntEl) return;
            const cnt = Array.from(document.querySelectorAll('#fileCheckboxes .index-checkbox')).filter(el => el.checked).length;
            cntEl.textContent = (cnt === 0) ? '(未选择)' : `(${cnt} 已选)`;
        }

        document.querySelectorAll('#fileCheckboxes .index-checkbox').forEach((el) => {
            el.addEventListener('change', () => {
                updateIndexSelectedCount();

                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => doSearch(), 150);
            });
        });


        updateIndexSelectedCount();
        if (openBtn) {
            openBtn.disabled = false;
            openBtn.classList.remove('loading');
        }

        const allChk = document.getElementById('_all_index_checkbox');
        allChk.addEventListener('change', (e) => {
            const checked = allChk.checked;
            document.querySelectorAll('#fileCheckboxes .index-checkbox').forEach((el) => { el.checked = checked; });
        });

        document.querySelectorAll('#fileCheckboxes .index-checkbox').forEach((el) => {
            el.addEventListener('change', () => {

                clearTimeout(searchTimer);
                searchTimer = setTimeout(() => doSearch(), 150);
            });
        });
    } catch (e) {

        const openBtnErr = document.getElementById('openIndexModalBtn');
        if (openBtnErr) {
            openBtnErr.disabled = false;
            openBtnErr.classList.remove('loading');
            const cntSpan = document.getElementById('indexSelectedCount');
            if (cntSpan) { cntSpan.textContent = '(加载失败)'; cntSpan.classList.add('text-error'); }
        }
    }
}

loadIndexList().catch(() => { });

document.getElementById('openIndexModalBtn')?.addEventListener('click', async () => {

    await loadIndexList();
    const dlg = document.getElementById('indexModal');
    if (!dlg) return;
    try {
        if (typeof dlg.showModal === 'function') dlg.showModal();
        else dlg.setAttribute('open', '');
    } catch (err) {

        dlg.setAttribute('open', '');
    }
});

async function doSearch() {
    if (!queryInput) return;
    const q = (queryInput.value || '').trim();
    if (!q) return;
    searchHideError();
    searchShowLoading();
    try {
        let fileParam = 'all';
        if (fileCheckboxes) {
            const allList = Array.from(document.querySelectorAll('#fileCheckboxes .index-checkbox')).map(el => el.value);
            const checked = Array.from(document.querySelectorAll('#fileCheckboxes .index-checkbox'))
                .filter((el) => el.checked)
                .map((el) => el.value);
            if (checked.length > 0 && checked.length !== allList.length) fileParam = checked.join(',');
        }
        const modeParam = (modeToggle && modeToggle.checked) ? '&mode=name' : '';

        searchHideError();
        searchShowLoading();
        searchBtnShowLoading();
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&file=${encodeURIComponent(fileParam)}${modeParam}`);
        if (!res.ok) {
            const body = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(body.error || `请求失败 ${res.status}`);
        }
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) {

            document.getElementById('searchResultsBox')?.classList.add('hidden');
            document.getElementById('searchEmpty')?.classList.remove('hidden');

            document.getElementById('results') && (document.getElementById('results').innerHTML = '');
            document.getElementById('resultsMobile') && (document.getElementById('resultsMobile').innerHTML = '');
            return;
        }

        document.getElementById('searchEmpty')?.classList.add('hidden');
        document.getElementById('searchResultsBox')?.classList.remove('hidden');
        const frag = document.createDocumentFragment();
        const fragMobile = document.createDocumentFragment();
        for (const item of data) {
            const a = document.createElement('a');

            a.className = 'block w-full p-3 rounded-lg hover:shadow-sm transition-colors';
            a.href = item.github_url || '#';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            const type = item.type || (item.size ? 'file' : 'directory');

            const typeClass = type === 'file' ? 'badge badge-outline badge-info' : 'badge badge-outline badge-primary';
            const typeLabel = type === 'file' ? '文件' : '文件夹';
            let sizeText = '-';
            if (typeof item.size === 'number' && !isNaN(item.size)) {
                const m = Math.round((item.size / 1024 / 1024) * 100) / 100;
                sizeText = `${m} MB`;
            } else if (typeof item.size_mb === 'number' && !isNaN(item.size_mb)) {
                sizeText = `${item.size_mb} MB`;
            }

            const titleHtml = (item.highlightedPath && item.highlightedPath !== 'undefined') ? item.highlightedPath : (item.highlightedName && item.highlightedName !== 'undefined') ? item.highlightedName : (item.name || '');
            a.innerHTML = `
                <div class="flex items-start justify-between w-full gap-4">
                    <div class="text-left flex-1">
                        <div class="text-lg font-semibold leading-tight break-all">${titleHtml}</div>
                        <div class="text-xs text-neutral-500 mt-1 whitespace-pre-wrap break-words break-all">${item.repository || ''} / ${item.branch || ''} — ${item.path || ''}</div>
                    </div>
                    <div class="flex flex-col items-end justify-start">
                        <div class="text-sm text-neutral-600">${sizeText}</div>
                        <div class="mt-2"><span class="${typeClass} text-sm">${typeLabel}</span></div>
                    </div>
                </div>
            `;
            a.classList.add('bg-base-200', 'bg-opacity-30');
            frag.appendChild(a);
            const aMobile = a.cloneNode(true);
            fragMobile.appendChild(aMobile);
        }
        const resultsDesktop = document.getElementById('results');
        if (resultsDesktop) { resultsDesktop.innerHTML = ''; resultsDesktop.appendChild(frag); }
        const resultsMobile = document.getElementById('resultsMobile');
        if (resultsMobile) { resultsMobile.innerHTML = ''; resultsMobile.appendChild(fragMobile); }
    } catch (e) {
        searchShowError(e.message || String(e));
    } finally {
        searchHideLoading();
        searchBtnHideLoading();
    }
}
