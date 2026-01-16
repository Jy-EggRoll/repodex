const tabRepos = document.getElementById('tab-repos');
const tabSearch = document.getElementById('tab-search');
const repoSection = document.getElementById('repoSection');
const searchSection = document.getElementById('searchSection');
const themeSelect = document.getElementById('themeSelect');

function switchToRepos() {
    tabRepos.classList.add('btn-active');
    tabSearch.classList.remove('btn-active');
    repoSection.classList.remove('hidden');
    searchSection.classList.add('hidden');
}
function switchToSearch() {
    tabSearch.classList.add('btn-active');
    tabRepos.classList.remove('btn-active');
    searchSection.classList.remove('hidden');
    repoSection.classList.add('hidden');
}

tabRepos.addEventListener('click', () => switchToRepos());
tabSearch.addEventListener('click', () => { switchToSearch(); loadIndexList(); });

function applyTheme(theme) {
    if (!theme) { document.documentElement.removeAttribute('data-theme'); }
    else { document.documentElement.setAttribute('data-theme', theme); }
}

const initialAppliedTheme = document.documentElement.getAttribute('data-theme') || '';
if (themeSelect && initialAppliedTheme) themeSelect.value = initialAppliedTheme;

themeSelect.addEventListener('change', () => {
    const v = themeSelect.value || '';
    applyTheme(v);
    const mobileThemeSelect = document.getElementById('mobileThemeSelect');
    if (mobileThemeSelect) mobileThemeSelect.value = v;
});

document.getElementById('brandBtn')?.addEventListener('click', () => switchToRepos());

document.getElementById('queryInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
});

document.getElementById('mobile-tab-repos')?.addEventListener('click', () => { switchToRepos(); });
document.getElementById('mobile-tab-search')?.addEventListener('click', () => { switchToSearch(); loadIndexList(); });

const mobileThemeSelect = document.getElementById('mobileThemeSelect');
if (mobileThemeSelect) {
    mobileThemeSelect.addEventListener('change', () => {
        const v = mobileThemeSelect.value || '';
        applyTheme(v);
        if (themeSelect) themeSelect.value = v;
    });
}
