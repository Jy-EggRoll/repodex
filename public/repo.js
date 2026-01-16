const loadBtn = document.getElementById('loadBtn');
const repoLoading = document.getElementById('repoLoading');
const repoError = document.getElementById('repoError');
const repoResults = document.getElementById('repoResults');
const repoList = null;
const repoCards = document.getElementById('repoCards');

function repoShowLoading() { repoLoading.classList.remove('hidden'); }
function repoHideLoading() { repoLoading.classList.add('hidden'); }
function repoShowError(message, kind = 'error') {
    repoError.textContent = message;
    repoError.classList.remove('hidden', 'alert-info', 'alert-error', 'alert-warning');
    if (kind === 'empty') repoError.classList.add('alert', 'alert-info');
    else if (kind === 'warn') repoError.classList.add('alert', 'alert-warning');
    else repoError.classList.add('alert', 'alert-error');
}
function repoHideError() { repoError.classList.add('hidden'); repoError.textContent = ''; }

function showResults() { if (repoResults) repoResults.classList.remove('hidden'); }
function hideResults() { if (repoResults) repoResults.classList.add('hidden'); }

function renderRepos(repos) {

    if (repoResults) repoResults.innerHTML = '';
    repoCards.innerHTML = '';

    const mapRisk = (r) => {

        if (r === 'danger') return ['危险', 'badge badge-outline badge-error'];
        if (r === 'warn') return ['警告', 'badge badge-outline badge-warning'];
        return ['安全', 'badge badge-outline badge-success'];
    };

    repos.forEach(repo => {
        const sizeText = (typeof repo.size_mb === 'number' && !isNaN(repo.size_mb)) ? `${repo.size_mb} MB` : `${((repo.size || 0) / 1024).toFixed(2)} MB`;
        const [riskLabel, riskClass] = mapRisk(repo.risk);

        if (repoResults) {
            const a = document.createElement('a');

            a.className = 'block w-full p-3 rounded-lg hover:shadow-sm transition-colors bg-base-200 bg-opacity-30';
            a.href = repo.html_url || '#';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.innerHTML = `
                <div class="flex items-start justify-between w-full gap-4">
                    <div class="text-left flex-1">
                        <div class="text-lg font-semibold leading-tight break-all">${repo.name}</div>
                        <div class="text-xs text-neutral-500 mt-1 whitespace-pre-wrap break-words break-all">${repo.description || ''}</div>
                    </div>
                    <div class="flex flex-col items-end justify-start">
                        <div class="text-sm text-neutral-600">${sizeText}</div>
                        <div class="mt-2"><span class="${riskClass} text-sm">${riskLabel}</span></div>
                    </div>
                </div>
            `;
            repoResults.appendChild(a);
        }

        const card = document.createElement('a');

        card.className = 'block w-full p-3 rounded-lg hover:shadow-sm transition-colors bg-base-200 bg-opacity-30';
        card.href = repo.html_url || '#';
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div class="flex-1">
                    <div class="font-semibold text-lg break-all">${repo.name}</div>
                    <div class="text-xs text-neutral-500 mt-1 whitespace-pre-wrap break-words break-all">${repo.description || ''}</div>
                </div>
                <div class="text-right">
                    <div class="text-sm text-neutral-600">${sizeText}</div>
                    <div class="mt-2"><span class="${riskClass} text-sm">${riskLabel}</span></div>
                </div>
            </div>
        `;
        repoCards.appendChild(card);
    });
}

loadBtn.addEventListener('click', async () => {
    loadBtn.disabled = true;
    repoShowLoading();
    repoHideError();
    hideResults();
    if (repoResults) repoResults.innerHTML = '';
    repoCards.innerHTML = '';
    try {
        const res = await fetch('/api/get-repo-info', { method: 'GET' });
        if (!res.ok) throw new Error('接口请求失败，请检查权限或网络状态');
        const repos = await res.json();
        if (!repos || repos.length === 0) { repoShowError('暂无仓库数据可展示', 'empty'); return; }
        repos.sort((a, b) => (b.size_mb || 0) - (a.size_mb || 0));
        renderRepos(repos);
        showResults();
    } catch (err) {
        repoShowError(`加载失败：${err.message}`);
    } finally {
        loadBtn.disabled = false;
        repoHideLoading();
    }
});
