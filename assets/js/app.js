const treeContainer = document.getElementById('tree-container');
const detailsContainer = document.getElementById('details-container');
const searchInput = document.getElementById('search-input');
const accountFilter = document.getElementById('account-filter');
const clearSearchBtn = document.getElementById('clear-search');
const expandAllBtn = document.getElementById('expand-all');
const collapseAllBtn = document.getElementById('collapse-all');
const themeToggleBtn = document.getElementById('theme-toggle');
const treeStatus = document.getElementById('tree-status');

const statCategories = document.getElementById('stat-categories');
const statLinks = document.getElementById('stat-links');
const statAccount = document.getElementById('stat-account');

const DEFAULT_BUILD_META = {
  version: 'dev',
  pushedAt: 'local / unknown',
  commit: '',
  shortSha: '',
  runNumber: ''
};

let buildMeta = { ...DEFAULT_BUILD_META };

let root = null;
let idCounter = 0;
let expanded = new Set();
let selectedId = null;
let currentQuery = '';
let showNoAccountOnly = false;
let openInlineIds = new Set();
const allNodes = [];

function decodeHtmlEntities(value = '') {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value);
  return textarea.value;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function regexEscape(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlight(text, query) {
  const safeText = escapeHtml(decodeHtmlEntities(text || ''));
  if (!query) return safeText;
  const pattern = new RegExp(`(${regexEscape(query)})`, 'ig');
  return safeText.replace(pattern, '<mark>$1</mark>');
}

function getNodeLabel(node) {
  return decodeHtmlEntities(node?.name || '');
}

function getNodeDescription(node) {
  return decodeHtmlEntities(node?.description || '');
}

function parseDateStrict(dateString) {
  if (!dateString || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return null;
  const date = new Date(`${dateString}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDaysSince(dateString) {
  const parsed = parseDateStrict(dateString);
  if (!parsed) return null;

  const now = new Date();
  const diffMs = now.getTime() - parsed.getTime();
  return Math.floor(diffMs / 86400000);
}

function getVerificationMeta(node) {
  if (!node?.lastVerified) {
    return {
      shortLabel: 'Unverified',
      className: 'badge verify-unknown',
      title: 'No verification date recorded'
    };
  }

  const days = getDaysSince(node.lastVerified);
  if (days === null) {
    return {
      shortLabel: 'Unverified',
      className: 'badge verify-unknown',
      title: 'Invalid verification date'
    };
  }

  if (days <= 60) {
    return {
      shortLabel: 'Fresh',
      className: 'badge verify-fresh',
      title: `Verified ${days} day${days === 1 ? '' : 's'} ago`
    };
  }

  if (days <= 180) {
    return {
      shortLabel: 'Aging',
      className: 'badge verify-aging',
      title: `Verified ${days} days ago`
    };
  }

  return {
    shortLabel: 'Stale',
    className: 'badge verify-stale',
    title: `Verified ${days} days ago`
  };
}

function computeDerivedStats(node) {
  if (!node.isFolder) {
    node.resourceCount = 1;
    node.categoryCount = 0;
    return { resourceCount: 1, categoryCount: 0 };
  }

  let resourceCount = 0;
  let categoryCount = 0;

  node.children.forEach(child => {
    const childStats = computeDerivedStats(child);
    resourceCount += childStats.resourceCount;
    categoryCount += child.isFolder ? 1 + childStats.categoryCount : childStats.categoryCount;
  });

  node.resourceCount = resourceCount;
  node.categoryCount = categoryCount;

  return { resourceCount, categoryCount };
}

function enrichTree(node, parent = null, depth = 0) {
  node.id = `node-${idCounter++}`;
  node.parent = parent;
  node.depth = depth;
  node.children = Array.isArray(node.children) ? node.children : [];
  node.isFolder = node.children.length > 0;
  node.requiresAccount = Boolean(node.requiresAccount);
  node.restricted = Boolean(node.restricted);

  node.displayName = getNodeLabel(node);
  node.displayDescription = getNodeDescription(node);
  node.searchText = [
    node.displayName,
    node.displayDescription,
    node.url,
    node.lastVerified
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  allNodes.push(node);
  node.children.forEach(child => enrichTree(child, node, depth + 1));
  return node;
}

function evaluateMatches(node, query) {
  const selfMatches = !query || node.searchText.includes(query);

  node.children.forEach(child => evaluateMatches(child, query));
  const childMatches = node.children.some(child => child.visible || child.queryMatches);

  const accountPass = !showNoAccountOnly || !node.requiresAccount;

  node.selfMatches = selfMatches;
  node.queryMatches = selfMatches || childMatches;

  if (node.isFolder) {
    const anyVisibleChild = node.children.some(child => child.visible);
    node.visible = accountPass && (selfMatches || anyVisibleChild || !query);
  } else {
    node.visible = accountPass && selfMatches;
  }

  return node.queryMatches;
}

function expandMatches(node) {
  if (!currentQuery && !showNoAccountOnly) return;

  if (node.visible && node.isFolder) {
    if (node.children.some(child => child.visible)) {
      expanded.add(node.id);
    }
    node.children.forEach(expandMatches);
  }
}

function resetExpansion() {
  if (!root) return;
  expanded = new Set([root.id]);
}

function countVisibleLinks(node) {
  if (!node.visible) return 0;
  if (!node.isFolder) return 1;
  return node.children.reduce((sum, child) => sum + countVisibleLinks(child), 0);
}

function renderStats() {
  const categoryCount = allNodes.filter(n => n.isFolder && n !== root).length;
  const linkCount = allNodes.filter(n => !n.isFolder).length;
  const accountCount = allNodes.filter(n => !n.isFolder && n.requiresAccount).length;

  statCategories.textContent = String(categoryCount);
  statLinks.textContent = String(linkCount);
  statAccount.textContent = String(accountCount);

  const visibleResources = root ? countVisibleLinks(root) : 0;

  const statusParts = [];
  statusParts.push(`Showing ${visibleResources} resource${visibleResources === 1 ? '' : 's'}`);

  if (currentQuery) {
    statusParts.push(`query: “${currentQuery}”`);
  }

  if (showNoAccountOnly) {
    statusParts.push('filter: no-account only');
  }

  treeStatus.textContent = statusParts.join(' • ');
}

function buildActionLink(url, text, className) {
  if (!url) return '';
  return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(text)}</a>`;
}

function renderInlineNodeDetails(node) {
  const verificationMeta = !node.isFolder ? getVerificationMeta(node) : null;
  const verificationBadge = verificationMeta
    ? `<span class="${verificationMeta.className}" title="${escapeHtml(verificationMeta.title)}">${escapeHtml(verificationMeta.shortLabel)}</span>`
    : '';

  const verifiedDateBadge = node.lastVerified
    ? `<span class="badge">Last verified: ${escapeHtml(node.lastVerified)}</span>`
    : '';

  const accountBadge = node.requiresAccount
    ? '<span class="badge account">Account required</span>'
    : '<span class="badge">No account required</span>';

  const restrictedBadge = node.restricted
    ? '<span class="badge restricted-badge">Restricted placeholder</span>'
    : '';

  const categorySummaryBadge = node.isFolder
    ? `<span class="badge category-meta">${node.resourceCount} resource${node.resourceCount === 1 ? '' : 's'}</span>`
    : '';

  const nestedCategoryBadge = node.isFolder && node !== root
    ? `<span class="badge category-meta">${node.categoryCount} subcategor${node.categoryCount === 1 ? 'y' : 'ies'}</span>`
    : '';

  return `
    <div class="inline-node-details__body">
      <p class="inline-node-details__description">
        ${escapeHtml(node.displayDescription || (node.isFolder ? 'Category folder' : 'No description provided.'))}
      </p>
      <div class="inline-node-details__meta">
        ${accountBadge}
        ${verificationBadge}
        ${verifiedDateBadge}
        ${restrictedBadge}
        ${categorySummaryBadge}
        ${nestedCategoryBadge}
      </div>
      <div class="inline-node-details__actions">
        ${buildActionLink(!node.isFolder ? node.url : '', 'Open resource', 'primary-link')}
        ${buildActionLink(node.url, 'Open in new tab', 'secondary-btn')}
      </div>
    </div>
  `;
}

function appendBadge(row, className, text, title = '') {
  const badge = document.createElement('span');
  badge.className = className;
  badge.textContent = text;
  if (title) badge.title = title;
  row.appendChild(badge);
}

function toggleInlineCard(node) {
  if (openInlineIds.has(node.id)) {
    openInlineIds.delete(node.id);
  } else {
    openInlineIds.add(node.id);
  }
}

function makeTreeNode(node) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.id = node.id;

  if (!node.visible) {
    li.classList.add('hidden');
  }

  const row = document.createElement('div');
  row.className = 'tree-row';

  if (selectedId === node.id) {
    row.classList.add('selected');
  }

  if (node.isFolder) {
    const toggle = document.createElement('button');
    toggle.className = 'toggle-btn';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', expanded.has(node.id) ? 'Collapse category' : 'Expand category');
    toggle.textContent = expanded.has(node.id) ? '−' : '+';

    toggle.addEventListener('click', () => {
      if (expanded.has(node.id)) {
        expanded.delete(node.id);
      } else {
        expanded.add(node.id);
      }
      render();
    });

    row.appendChild(toggle);
  } else {
    const spacer = document.createElement('span');
    spacer.className = 'toggle-placeholder';
    row.appendChild(spacer);
  }

  const icon = document.createElement('span');
  icon.className = `node-icon ${node.isFolder ? 'folder' : ''}`;
  row.appendChild(icon);

  const label = document.createElement('button');
  label.className = 'node-label';
  label.type = 'button';
  label.innerHTML = highlight(node.displayName || node.name || '', currentQuery);

  label.addEventListener('click', (event) => {
    event.preventDefault();

    selectedId = node.id;

    if (node.isFolder) {
      expanded.add(node.id);
    }

    toggleInlineCard(node);
    render();
  });

  row.appendChild(label);

  if (node.isFolder) {
    appendBadge(
      row,
      'badge category-meta',
      `${node.resourceCount} resource${node.resourceCount === 1 ? '' : 's'}`,
      `${node.resourceCount} resource${node.resourceCount === 1 ? '' : 's'} inside this category`
    );
  } else {
    if (node.requiresAccount) {
      appendBadge(row, 'badge account', 'Account', 'Account required');
    }

    const verificationMeta = getVerificationMeta(node);
    appendBadge(row, verificationMeta.className, verificationMeta.shortLabel, verificationMeta.title);

    if (node.lastVerified) {
      appendBadge(row, 'badge', node.lastVerified, `Last verified on ${node.lastVerified}`);
    }

    if (node.restricted) {
      appendBadge(row, 'badge restricted-badge', 'Restricted', 'Restricted placeholder');
    }

    if (node.url) {
      const openBtn = document.createElement('a');
      openBtn.className = 'tree-open-btn';
      openBtn.href = node.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noreferrer noopener';
      openBtn.textContent = 'Open';
      row.appendChild(openBtn);
    }
  }

  li.appendChild(row);

  if (openInlineIds.has(node.id)) {
    const inlineDetails = document.createElement('div');
    inlineDetails.className = 'inline-node-details';
    inlineDetails.innerHTML = renderInlineNodeDetails(node);
    li.appendChild(inlineDetails);
  }

  if (node.isFolder) {
    const childList = document.createElement('ul');
    childList.className = 'children';

    if (!expanded.has(node.id)) {
      childList.classList.add('collapsed');
    }

    node.children.forEach(child => {
      childList.appendChild(makeTreeNode(child));
    });

    li.appendChild(childList);
  }

  return li;
}

function renderLegendOnly() {
  detailsContainer.innerHTML = `
    <div class="legend-card">
      <h4 class="legend-title">Legend</h4>
      <div class="legend-grid">
        <div class="legend-item">
          <span class="badge category-meta">12 resources</span>
          <span>Category contains this many resources.</span>
        </div>
        <div class="legend-item">
          <span class="badge account">Account required</span>
          <span>Sign-in is needed for part or all of the service.</span>
        </div>
        <div class="legend-item">
          <span class="badge verify-fresh">Fresh</span>
          <span>Verified recently.</span>
        </div>
        <div class="legend-item">
          <span class="badge verify-aging">Aging</span>
          <span>Verified, but should be reviewed soon.</span>
        </div>
        <div class="legend-item">
          <span class="badge verify-stale">Stale</span>
          <span>Verification is old and should be refreshed.</span>
        </div>
        <div class="legend-item">
          <span class="badge verify-unknown">Unverified</span>
          <span>No verification date has been recorded yet.</span>
        </div>
        <div class="legend-item">
          <span class="badge restricted-badge">Restricted</span>
          <span>Placeholder entry shown without exposing direct public links.</span>
        </div>
      </div>
    </div>
  `;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();

  let success = false;
  try {
    success = document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }

  if (!success) {
    throw new Error('Clipboard copy failed');
  }

  return true;
}

async function loadBuildMeta() {
  try {
    const response = await fetch('./data/build-meta.json', { cache: 'no-store' });
    if (!response.ok) {
      buildMeta = { ...DEFAULT_BUILD_META };
      return;
    }

    const json = await response.json();
    buildMeta = {
      ...DEFAULT_BUILD_META,
      ...json
    };
  } catch (error) {
    console.warn('Could not load build metadata:', error);
    buildMeta = { ...DEFAULT_BUILD_META };
  }
}

function ensureBuildMetaPlacement() {
  const actionsContainer = themeToggleBtn?.parentElement;
  if (!actionsContainer || !themeToggleBtn) return;

  let stack = document.getElementById('build-theme-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'build-theme-stack';
    stack.className = 'build-theme-stack';
  }

  let badge = document.getElementById('build-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'build-badge';
    badge.className = 'build-badge-inline';
  }

  const titleParts = [];
  if (buildMeta.commit) titleParts.push(`Commit: ${buildMeta.commit}`);
  if (buildMeta.runNumber) titleParts.push(`Run: ${buildMeta.runNumber}`);
  badge.title = titleParts.join(' • ');

  badge.innerHTML = `
    <div class="build-badge__version">${escapeHtml(buildMeta.version)}</div>
    <div class="build-badge__time">${escapeHtml(buildMeta.pushedAt)}</div>
  `;

  if (themeToggleBtn.parentElement !== stack) {
    actionsContainer.insertBefore(stack, themeToggleBtn);
    stack.appendChild(badge);
    stack.appendChild(themeToggleBtn);
  } else if (!stack.contains(badge)) {
    stack.insertBefore(badge, themeToggleBtn);
  }
}

function ensureShareButton() {
  let shareBtn = document.getElementById('copy-share-btn');
  if (!shareBtn) {
    shareBtn = document.createElement('button');
    shareBtn.id = 'copy-share-btn';
    shareBtn.type = 'button';
    shareBtn.className = 'ghost-btn';
    shareBtn.textContent = 'Copy/share';

    if (clearSearchBtn && clearSearchBtn.parentElement) {
      clearSearchBtn.insertAdjacentElement('afterend', shareBtn);
    }
  }

  if (!shareBtn.dataset.bound) {
    shareBtn.addEventListener('click', async () => {
      const originalText = 'Copy/share';

      try {
        await copyTextToClipboard(window.location.href);
        shareBtn.textContent = 'Copied!';
        shareBtn.classList.add('copied');
      } catch (error) {
        console.error(error);
        shareBtn.textContent = 'Copy failed';
        shareBtn.classList.add('copy-failed');
      }

      window.setTimeout(() => {
        shareBtn.textContent = originalText;
        shareBtn.classList.remove('copied');
        shareBtn.classList.remove('copy-failed');
      }, 1800);
    });

    shareBtn.dataset.bound = 'true';
  }
}

function render() {
  if (!root) return;

  evaluateMatches(root, currentQuery);

  if (currentQuery || showNoAccountOnly) {
    expandMatches(root);
  }

  const ul = document.createElement('ul');
  ul.className = 'tree-root';
  ul.appendChild(makeTreeNode(root));

  treeContainer.replaceChildren(ul);

  renderStats();
  renderLegendOnly();
  ensureBuildMetaPlacement();
  ensureShareButton();
}

function expandAllFolders() {
  allNodes
    .filter(node => node.isFolder)
    .forEach(node => expanded.add(node.id));

  render();
}

function collapseAllFolders() {
  resetExpansion();
  render();
}

function applyThemePreference() {
  const stored = localStorage.getItem('sst-theme');
  if (stored === 'light') {
    document.body.classList.add('light');
    themeToggleBtn.setAttribute('aria-pressed', 'true');
  }
}

async function init() {
  const response = await fetch('./data/tree.json');

  if (!response.ok) {
    throw new Error(`Failed to load tree.json (${response.status} ${response.statusText})`);
  }

  const data = await response.json();

  allNodes.length = 0;
  idCounter = 0;
  selectedId = null;
  openInlineIds = new Set();

  root = enrichTree(data);
  computeDerivedStats(root);
  resetExpansion();
  applyThemePreference();
  await loadBuildMeta();
  ensureBuildMetaPlacement();
  ensureShareButton();
  renderLegendOnly();

  render();
}

searchInput.addEventListener('input', () => {
  currentQuery = searchInput.value.trim().toLowerCase();

  if (!currentQuery && !showNoAccountOnly) {
    resetExpansion();
  }

  render();
});

accountFilter.addEventListener('change', () => {
  showNoAccountOnly = accountFilter.checked;

  if (!currentQuery && !showNoAccountOnly) {
    resetExpansion();
  }

  render();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  accountFilter.checked = false;
  currentQuery = '';
  showNoAccountOnly = false;

  resetExpansion();
  render();
});

expandAllBtn.addEventListener('click', expandAllFolders);
collapseAllBtn.addEventListener('click', collapseAllFolders);

themeToggleBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light');
  themeToggleBtn.setAttribute('aria-pressed', String(isLight));
  localStorage.setItem('sst-theme', isLight ? 'light' : 'dark');
});

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }

  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.blur();
  }
});

init().catch(error => {
  treeContainer.innerHTML = `<div class="details-card"><h3>Could not load data</h3><p>${escapeHtml(String(error))}</p></div>`;
});
