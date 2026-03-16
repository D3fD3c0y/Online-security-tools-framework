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
const statVisible = document.getElementById('stat-visible');
const statAccount = document.getElementById('stat-account');

const BUILD_META = {
  version: 'v0.7.0',
  pushedAt: '2026-03-16 08:44 GMT-04:00'
};

let root = null;
let idCounter = 0;
let expanded = new Set();
let selectedId = null;
let currentQuery = '';
let showNoAccountOnly = false;
let pendingSelectedPath = '';
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

function getNodePath(node) {
  const parts = [];
  let current = node;

  while (current) {
    parts.unshift(getNodeLabel(current));
    current = current.parent;
  }

  return parts.join(' > ');
}

function findNodeByPath(path) {
  if (!path) return null;
  return allNodes.find(node => getNodePath(node) === path) || null;
}

function expandAncestors(node) {
  let current = node?.parent || null;

  while (current) {
    expanded.add(current.id);
    current = current.parent;
  }
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
      fullLabel: 'Verification status: unverified',
      className: 'badge verify-unknown',
      title: 'No verification date recorded'
    };
  }

  const days = getDaysSince(node.lastVerified);
  if (days === null) {
    return {
      shortLabel: 'Unverified',
      fullLabel: 'Verification status: unverified',
      className: 'badge verify-unknown',
      title: 'Invalid verification date'
    };
  }

  if (days <= 60) {
    return {
      shortLabel: 'Fresh',
      fullLabel: `Verification status: fresh (${days} day${days === 1 ? '' : 's'} ago)`,
      className: 'badge verify-fresh',
      title: `Verified ${days} day${days === 1 ? '' : 's'} ago`
    };
  }

  if (days <= 180) {
    return {
      shortLabel: 'Aging',
      fullLabel: `Verification status: aging (${days} days ago)`,
      className: 'badge verify-aging',
      title: `Verified ${days} days ago`
    };
  }

  return {
    shortLabel: 'Stale',
    fullLabel: `Verification status: stale (${days} days ago)`,
    className: 'badge verify-stale',
    title: `Verified ${days} days ago`
  };
}

function computeDerivedStats(node) {
  if (!node.isFolder) {
    node.resourceCount = 1;
    node.categoryCount = 0;
    return {
      resourceCount: 1,
      categoryCount: 0
    };
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

  return {
    resourceCount,
    categoryCount
  };
}

function getSelfMatchScore(node, query) {
  if (!query) return 0;

  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const name = node.displayNameLower || '';
  const desc = node.displayDescriptionLower || '';
  const url = node.urlLower || '';
  const words = q.split(/\s+/).filter(Boolean);

  let score = 0;

  if (name === q) {
    score = Math.max(score, 1000);
  } else if (name.startsWith(q)) {
    score = Math.max(score, 850);
  } else if (name.includes(q)) {
    score = Math.max(score, 700);
  }

  if (desc === q) {
    score = Math.max(score, 600);
  } else if (desc.startsWith(q)) {
    score = Math.max(score, 450);
  } else if (desc.includes(q)) {
    score = Math.max(score, 300);
  }

  if (url.includes(q)) {
    score = Math.max(score, 180);
  }

  for (const word of words) {
    if (!word) continue;

    if (name === word) {
      score += 120;
    } else if (name.startsWith(word)) {
      score += 75;
    } else if (name.includes(word)) {
      score += 45;
    }

    if (desc.includes(word)) {
      score += 12;
    }

    if (url.includes(word)) {
      score += 5;
    }
  }

  if (node.isFolder && score > 0) {
    score += 15;
  }

  return score;
}

function enrichTree(node, parent = null, depth = 0) {
  node.id = `node-${idCounter++}`;
  node.parent = parent;
  node.depth = depth;
  node.children = Array.isArray(node.children) ? node.children : [];
  node.isFolder = node.children.length > 0;
  node.requiresAccount = Boolean(node.requiresAccount);

  node.displayName = getNodeLabel(node);
  node.displayDescription = getNodeDescription(node);
  node.displayNameLower = node.displayName.toLowerCase();
  node.displayDescriptionLower = node.displayDescription.toLowerCase();
  node.urlLower = (node.url || '').toLowerCase();

  node.searchText = [
    node.displayName,
    node.displayDescription,
    node.url,
    node.lastVerified
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  node.matchScore = 0;
  node.selfMatchScore = 0;

  allNodes.push(node);
  node.children.forEach(child => enrichTree(child, node, depth + 1));
  return node;
}

function evaluateMatches(node, query) {
  const selfMatches = !query || node.searchText.includes(query);

  const childResults = node.children.map(child => evaluateMatches(child, query));
  const childMatches = childResults.some(Boolean);

  const accountPass = !showNoAccountOnly || !node.requiresAccount;

  node.selfMatches = selfMatches;
  node.queryMatches = selfMatches || childMatches;
  node.selfMatchScore = getSelfMatchScore(node, query);

  if (node.isFolder) {
    const anyVisibleChild = node.children.some(child => child.visible);
    node.visible = accountPass && (selfMatches || anyVisibleChild || !query);
  } else {
    node.visible = accountPass && selfMatches;
  }

  const visibleChildScores = node.children
    .filter(child => child.visible)
    .map(child => child.matchScore || 0);

  const bestChildScore = visibleChildScores.length ? Math.max(...visibleChildScores) : 0;

  if (!query) {
    node.matchScore = 0;
  } else if (node.isFolder) {
    node.matchScore = Math.max(node.selfMatchScore, bestChildScore > 0 ? bestChildScore - 1 : 0);
  } else {
    node.matchScore = node.visible ? node.selfMatchScore : 0;
  }

  return node.queryMatches;
}

function compareSearchRank(a, b, preferFolders = false) {
  if (a.visible !== b.visible) {
    return a.visible ? -1 : 1;
  }

  if ((b.matchScore || 0) !== (a.matchScore || 0)) {
    return (b.matchScore || 0) - (a.matchScore || 0);
  }

  if (a.selfMatches !== b.selfMatches) {
    return a.selfMatches ? -1 : 1;
  }

  if (a.isFolder !== b.isFolder) {
    if (preferFolders) {
      return a.isFolder ? -1 : 1;
    }
    return a.isFolder ? 1 : -1;
  }

  if ((b.resourceCount || 0) !== (a.resourceCount || 0)) {
    return (b.resourceCount || 0) - (a.resourceCount || 0);
  }

  return (a.displayName || '').localeCompare(b.displayName || '', undefined, { sensitivity: 'base' });
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

function countVisibleCategories(node) {
  if (!node.visible || !node.isFolder) return 0;
  return (node !== root ? 1 : 0) + node.children.reduce((sum, child) => sum + countVisibleCategories(child), 0);
}

function getSortedChildren(node) {
  const children = [...node.children];

  if (!currentQuery) {
    return children;
  }

  children.sort((a, b) => compareSearchRank(a, b, true));
  return children;
}

function getTopMatches(limit = 6) {
  if (!currentQuery) return [];

  return allNodes
    .filter(node => node.visible && node.matchScore > 0)
    .sort((a, b) => compareSearchRank(a, b, false))
    .slice(0, limit);
}

function getMatchingCategories(limit = 6) {
  if (!currentQuery) return [];

  return allNodes
    .filter(node => node.isFolder && node !== root && node.visible)
    .map(node => ({
      node,
      visibleResourceCount: countVisibleLinks(node)
    }))
    .filter(item => item.visibleResourceCount > 0)
    .sort((a, b) => {
      if (b.visibleResourceCount !== a.visibleResourceCount) {
        return b.visibleResourceCount - a.visibleResourceCount;
      }

      if ((b.node.matchScore || 0) !== (a.node.matchScore || 0)) {
        return (b.node.matchScore || 0) - (a.node.matchScore || 0);
      }

      return (a.node.displayName || '').localeCompare(b.node.displayName || '', undefined, { sensitivity: 'base' });
    })
    .slice(0, limit);
}

function buildActionLink(url, text, className) {
  if (!url) return '';
  return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(text)}</a>`;
}

function renderStats() {
  const categoryCount = allNodes.filter(n => n.isFolder && n !== root).length;
  const linkCount = allNodes.filter(n => !n.isFolder).length;
  const visibleCount = root ? countVisibleLinks(root) : 0;
  const accountCount = allNodes.filter(n => !n.isFolder && n.requiresAccount).length;
  const visibleCategoryCount = root ? countVisibleCategories(root) : 0;

  statCategories.textContent = String(categoryCount);
  statLinks.textContent = String(linkCount);
  statVisible.textContent = String(visibleCount);
  statAccount.textContent = String(accountCount);

  const statusParts = [];
  statusParts.push(`Showing ${visibleCount} resource${visibleCount === 1 ? '' : 's'}`);
  statusParts.push(`${visibleCategoryCount} categor${visibleCategoryCount === 1 ? 'y' : 'ies'} visible`);

  if (currentQuery) {
    statusParts.push(`query: “${currentQuery}”`);
  }

  if (showNoAccountOnly) {
    statusParts.push('filter: no-account only');
  }

  treeStatus.textContent = statusParts.join(' • ');
}

function renderLegend() {
  return `
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
      </div>
    </div>
  `;
}

function renderSearchSummaryPanel() {
  if (!currentQuery) return '';

  const visibleResourceCount = root ? countVisibleLinks(root) : 0;
  const visibleCategoryCount = root ? countVisibleCategories(root) : 0;
  const topMatches = getTopMatches(6);
  const matchingCategories = getMatchingCategories(6);

  const topMatchesHtml = topMatches.length
    ? topMatches.map(node => `
        <button type="button" class="summary-link-btn" data-jump-node-id="${escapeHtml(node.id)}">
          <span class="summary-link-title">${escapeHtml(node.displayName)}</span>
          <span class="summary-link-path">${escapeHtml(getNodePath(node))}</span>
        </button>
      `).join('')
    : '<p class="legend-copy">No direct matches were found for the current search and filter combination.</p>';

  const matchingCategoriesHtml = matchingCategories.length
    ? matchingCategories.map(item => `
        <button type="button" class="summary-category-btn" data-jump-node-id="${escapeHtml(item.node.id)}">
          <span class="summary-category-name">${escapeHtml(item.node.displayName)}</span>
          <span class="summary-category-count">${item.visibleResourceCount} match${item.visibleResourceCount === 1 ? '' : 'es'}</span>
        </button>
      `).join('')
    : '<p class="legend-copy">No matching categories found.</p>';

  return `
    <section class="search-summary-panel">
      <div class="summary-header">
        <div>
          <h4 class="summary-title">Search summary</h4>
          <p class="summary-subtitle">Results for “${escapeHtml(currentQuery)}”</p>
        </div>
        <div class="summary-stats">
          <span class="badge category-meta">${visibleResourceCount} resource${visibleResourceCount === 1 ? '' : 's'}</span>
          <span class="badge category-meta">${visibleCategoryCount} categor${visibleCategoryCount === 1 ? 'y' : 'ies'}</span>
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary-card">
          <h5 class="summary-card-title">Top matches</h5>
          <div class="summary-link-list">
            ${topMatchesHtml}
          </div>
        </div>

        <div class="summary-card">
          <h5 class="summary-card-title">Matching categories</h5>
          <div class="summary-category-list">
            ${matchingCategoriesHtml}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderDetails(node) {
  const summaryPanel = renderSearchSummaryPanel();

  if (!node) {
    detailsContainer.className = 'details-empty';
    detailsContainer.innerHTML = `
      ${summaryPanel}
      <p>Select a category or resource to inspect its metadata here.</p>
      ${renderLegend()}
    `;
    wireSummaryActions();
    return;
  }

  const typeBadge = node.isFolder
    ? '<span class="badge">Category</span>'
    : '<span class="badge">Resource</span>';

  const accountBadge = node.requiresAccount
    ? '<span class="badge account">Account required</span>'
    : '<span class="badge">No account required</span>';

  const verificationMeta = !node.isFolder ? getVerificationMeta(node) : null;

  const verificationBadge = verificationMeta
    ? `<span class="${verificationMeta.className}" title="${escapeHtml(verificationMeta.title)}">${escapeHtml(verificationMeta.shortLabel)}</span>`
    : '';

  const verifiedDateBadge = node.lastVerified
    ? `<span class="badge">Last verified: ${escapeHtml(node.lastVerified)}</span>`
    : '';

  const parentBadge = node.parent && node.parent !== root
    ? `<span class="badge">Parent: ${escapeHtml(node.parent.displayName || node.parent.name || '')}</span>`
    : '';

  const categorySummaryBadge = node.isFolder
    ? `<span class="badge category-meta">${node.resourceCount} resource${node.resourceCount === 1 ? '' : 's'}</span>`
    : '';

  const nestedCategoryBadge = node.isFolder && node !== root
    ? `<span class="badge category-meta">${node.categoryCount} subcategor${node.categoryCount === 1 ? 'y' : 'ies'}</span>`
    : '';

  const pathBadge = `<span class="badge path-badge">${escapeHtml(getNodePath(node))}</span>`;

  const extraPanel = node === root || node.isFolder
    ? renderLegend()
    : `
      <div class="legend-card">
        <h4 class="legend-title">Verification details</h4>
        <p class="legend-copy">
          ${verificationMeta ? escapeHtml(verificationMeta.fullLabel) : 'This item has no verification metadata.'}
        </p>
      </div>
    `;

  detailsContainer.className = 'details-card';
  detailsContainer.innerHTML = `
    ${summaryPanel}
    <h3 class="details-title">${escapeHtml(node.displayName || node.name || '')}</h3>
    <p class="details-description">${escapeHtml(node.displayDescription || (node.isFolder ? 'Category folder' : 'No description provided.'))}</p>
    <div class="meta-list">
      ${typeBadge}
      ${accountBadge}
      ${verificationBadge}
      ${verifiedDateBadge}
      ${categorySummaryBadge}
      ${nestedCategoryBadge}
      ${parentBadge}
      ${pathBadge}
    </div>
    <div class="details-actions">
      ${buildActionLink(!node.isFolder ? node.url : '', 'Open resource', 'primary-link')}
      ${buildActionLink(node.url, 'Open in new tab', 'secondary-btn')}
    </div>
    ${extraPanel}
  `;

  wireSummaryActions();
}

function wireSummaryActions() {
  detailsContainer.querySelectorAll('[data-jump-node-id]').forEach(button => {
    button.addEventListener('click', () => {
      const nodeId = button.getAttribute('data-jump-node-id');
      const node = allNodes.find(item => item.id === nodeId);

      if (!node) return;

      selectedId = node.id;
      expandAncestors(node);

      if (node.isFolder) {
        expanded.add(node.id);
      }

      renderDetails(node);
      render();
    });
  });
}

function appendBadge(row, className, text, title = '') {
  const badge = document.createElement('span');
  badge.className = className;
  badge.textContent = text;
  if (title) {
    badge.title = title;
  }
  row.appendChild(badge);
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

      selectedId = node.id;
      expandAncestors(node);
      renderDetails(node);
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

  const label = node.url && !node.isFolder
    ? document.createElement('a')
    : document.createElement('button');

  label.className = node.url && !node.isFolder ? 'node-link' : 'node-label';
  label.innerHTML = highlight(node.displayName || node.name || '', currentQuery);

  if (node.url && !node.isFolder) {
    label.href = node.url;
    label.target = '_blank';
    label.rel = 'noreferrer noopener';
  } else {
    label.type = 'button';
  }

  label.addEventListener('click', (event) => {
    if (!node.url || node.isFolder) {
      event.preventDefault();
    }

    selectedId = node.id;

    if (node.isFolder) {
      expanded.add(node.id);
    }

    expandAncestors(node);
    renderDetails(node);
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
  }

  li.appendChild(row);

  if (node.isFolder) {
    const childList = document.createElement('ul');
    childList.className = 'children';

    if (!expanded.has(node.id)) {
      childList.classList.add('collapsed');
    }

    getSortedChildren(node).forEach(child => {
      childList.appendChild(makeTreeNode(child));
    });

    li.appendChild(childList);
  }

  return li;
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);

  currentQuery = (params.get('q') || '').trim().toLowerCase();
  showNoAccountOnly = params.get('noacct') === '1';
  pendingSelectedPath = params.get('sel') || '';

  searchInput.value = currentQuery;
  accountFilter.checked = showNoAccountOnly;
}

function writeUrlState() {
  const params = new URLSearchParams();

  if (currentQuery) {
    params.set('q', currentQuery);
  }

  if (showNoAccountOnly) {
    params.set('noacct', '1');
  }

  const selectedNode = allNodes.find(node => node.id === selectedId);
  if (selectedNode) {
    params.set('sel', getNodePath(selectedNode));
  }

  const search = params.toString();
  const newUrl = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;

  window.history.replaceState({}, '', newUrl);
}

function applySelectionFromPendingPath() {
  const restoredNode = findNodeByPath(pendingSelectedPath);

  if (restoredNode) {
    selectedId = restoredNode.id;
    expandAncestors(restoredNode);

    if (restoredNode.isFolder) {
      expanded.add(restoredNode.id);
    }

    renderDetails(restoredNode);
    return;
  }

  selectedId = root?.id || null;
  renderDetails(root);
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

  badge.innerHTML = `
    <div class="build-badge__version">${escapeHtml(BUILD_META.version)}</div>
    <div class="build-badge__time">${escapeHtml(BUILD_META.pushedAt)}</div>
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

  const selectedNode = allNodes.find(node => node.id === selectedId);
  if (selectedNode && selectedNode.visible) {
    renderDetails(selectedNode);
  } else if (selectedId && selectedNode && !selectedNode.visible) {
    selectedId = null;
    renderDetails(null);
  } else if (!selectedId) {
    renderDetails(currentQuery ? null : root);
  }

  writeUrlState();
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

  const selectedNode = allNodes.find(node => node.id === selectedId);
  if (selectedNode) {
    expandAncestors(selectedNode);
    if (selectedNode.isFolder) {
      expanded.add(selectedNode.id);
    }
  }

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

  readUrlState();

  root = enrichTree(data);
  computeDerivedStats(root);
  resetExpansion();
  applyThemePreference();
  ensureBuildMetaPlacement();
  ensureShareButton();
  applySelectionFromPendingPath();

  render();
}

searchInput.addEventListener('input', () => {
  currentQuery = searchInput.value.trim().toLowerCase();

  if (!currentQuery && !showNoAccountOnly) {
    resetExpansion();

    const selectedNode = allNodes.find(node => node.id === selectedId);
    if (selectedNode) {
      expandAncestors(selectedNode);
      if (selectedNode.isFolder) {
        expanded.add(selectedNode.id);
      }
    }
  }

  render();
});

accountFilter.addEventListener('change', () => {
  showNoAccountOnly = accountFilter.checked;

  if (!currentQuery && !showNoAccountOnly) {
    resetExpansion();

    const selectedNode = allNodes.find(node => node.id === selectedId);
    if (selectedNode) {
      expandAncestors(selectedNode);
      if (selectedNode.isFolder) {
        expanded.add(selectedNode.id);
      }
    }
  }

  render();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  accountFilter.checked = false;
  currentQuery = '';
  showNoAccountOnly = false;

  resetExpansion();

  const selectedNode = allNodes.find(node => node.id === selectedId);
  if (selectedNode) {
    expandAncestors(selectedNode);
    if (selectedNode.isFolder) {
      expanded.add(selectedNode.id);
    }
  }

  render();
});

expandAllBtn.addEventListener('click', expandAllFolders);
collapseAllBtn.addEventListener('click', collapseAllFolders);

themeToggleBtn.addEventListener('click', () => {
  const isLight = document.body.classList.toggle('light');
  themeToggleBtn.setAttribute('aria-pressed', String(isLight));
  localStorage.setItem('sst-theme', isLight ? 'light' : 'dark');
});

window.addEventListener('popstate', () => {
  if (!root) return;

  readUrlState();
  resetExpansion();
  applySelectionFromPendingPath();
  render();
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
