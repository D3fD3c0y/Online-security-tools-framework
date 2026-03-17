const treeContainer = document.getElementById('tree-container');
const detailsContainer = document.getElementById('details-container');
const searchInput = document.getElementById('search-input');
const accountFilter = document.getElementById('account-filter');
const clearSearchBtn = document.getElementById('clear-search');
const expandAllBtn = document.getElementById('expand-all');
const collapseAllBtn = document.getElementById('collapse-all');
const themeToggleBtn = document.getElementById('theme-toggle');
const treeStatus = document.getElementById('tree-status');

const exportMarkdownBtn = document.getElementById('export-markdown');
const exportCsvBtn = document.getElementById('export-csv');

const statCategories = document.getElementById('stat-categories');
const statLinks = document.getElementById('stat-links');
const statAccount = document.getElementById('stat-account');

const DEFAULT_BUILD_META = {
  version: 'dev',
  pushedAt: 'local / unknown',
  commit: '',
  shortSha: '',
  runNumber: '',
  sourceRepo: '',
  sourceRef: '',
  sourceSha: '',
  sourceShortSha: ''
};

const MAX_TREE_DEPTH = 12;
const MAX_TREE_NODES = 10000;
const MAX_STRING_LENGTH = 600;

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

function normalizeString(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = decodeHtmlEntities(value).trim();
  return trimmed.length > MAX_STRING_LENGTH
    ? `${trimmed.slice(0, MAX_STRING_LENGTH)}…`
    : trimmed;
}

function sanitizeExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }

  const candidate = decodeHtmlEntities(value).trim();

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return '';
  } catch {
    return '';
  }
}

function csvSafe(value) {
  const stringValue = String(value ?? '');
  if (/^[=+\-@]/.test(stringValue) || /^[\t\r]/.test(stringValue)) {
    return `'${stringValue}`;
  }
  return stringValue;
}

function getNodeLabel(node) {
  return normalizeString(node?.name || '');
}

function getNodeDescription(node) {
  return normalizeString(node?.description || '');
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

function getNodeCategoryPath(node) {
  const parts = [];
  let current = node?.parent || null;

  while (current && current !== root) {
    parts.unshift(getNodeLabel(current));
    current = current.parent;
  }

  return parts.join(' > ');
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
    node.displayResourceCount = 1;
    node.categoryCount = 0;
    return {
      resourceCount: 1,
      displayResourceCount: 1,
      categoryCount: 0
    };
  }

  let resourceCount = 0;
  let displayResourceCount = 0;
  let categoryCount = 0;

  node.children.forEach(child => {
    const childStats = computeDerivedStats(child);
    resourceCount += childStats.resourceCount;
    displayResourceCount += childStats.displayResourceCount;
    categoryCount += child.isFolder ? 1 + childStats.categoryCount : childStats.categoryCount;
  });

  node.resourceCount = resourceCount;
  node.categoryCount = categoryCount;

  if (node.restricted && typeof node.sourceCount === 'number') {
    node.displayResourceCount = node.sourceCount;
  } else {
    node.displayResourceCount = displayResourceCount;
  }

  return {
    resourceCount,
    displayResourceCount: node.displayResourceCount,
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

  let score = 0;

  if (name === q) {
    score = Math.max(score, 1000);
  } else if (name.startsWith(q)) {
    score = Math.max(score, 850);
  } else if (name.includes(q)) {
    score = Math.max(score, 700);
  }

  if (desc === q) {
    score = Math.max(score, 550);
  } else if (desc.startsWith(q)) {
    score = Math.max(score, 420);
  } else if (desc.includes(q)) {
    score = Math.max(score, 280);
  }

  if (url.includes(q)) {
    score = Math.max(score, 160);
  }

  if (node.restricted) {
    score -= 10;
  }

  if (node.isInsecureUrl) {
    score -= 5;
  }

  return Math.max(score, 0);
}

function normalizeTreeNode(input, parent = null, depth = 0, state = { count: 0 }) {
  if (!input || typeof input !== 'object') {
    return null;
  }

  if (depth > MAX_TREE_DEPTH) {
    return null;
  }

  state.count += 1;
  if (state.count > MAX_TREE_NODES) {
    return null;
  }

  const childrenInput = Array.isArray(input.children) ? input.children : [];
  const normalizedChildren = [];

  for (const child of childrenInput) {
    const normalizedChild = normalizeTreeNode(child, null, depth + 1, state);
    if (normalizedChild) {
      normalizedChildren.push(normalizedChild);
    }
  }

  const normalized = {
    id: `node-${idCounter++}`,
    parent,
    depth,
    name: normalizeString(input.name || 'Unnamed'),
    description: normalizeString(input.description || ''),
    type: normalizeString(input.type || (normalizedChildren.length ? 'folder' : 'link')),
    url: sanitizeExternalUrl(input.url || ''),
    requiresAccount: Boolean(input.requiresAccount),
    restricted: Boolean(input.restricted),
    lastVerified: normalizeString(input.lastVerified || ''),
    sourceCount: typeof input.sourceCount === 'number' && Number.isFinite(input.sourceCount)
      ? Math.max(0, Math.floor(input.sourceCount))
      : undefined,
    children: normalizedChildren
  };

  normalized.isFolder = normalized.children.length > 0;
  normalized.displayName = normalized.name;
  normalized.displayDescription = normalized.description;
  normalized.displayNameLower = normalized.displayName.toLowerCase();
  normalized.displayDescriptionLower = normalized.displayDescription.toLowerCase();
  normalized.urlLower = normalized.url.toLowerCase();
  normalized.isInsecureUrl = normalized.url.startsWith('http://');

  normalized.searchText = [
    normalized.displayName,
    normalized.displayDescription,
    normalized.url,
    normalized.lastVerified
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  normalized.matchScore = 0;
  normalized.selfMatchScore = 0;
  normalized.selfMatches = false;
  normalized.queryMatches = false;
  normalized.visible = true;

  normalized.children.forEach(child => {
    child.parent = normalized;
  });

  allNodes.push(normalized);
  return normalized;
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

function compareSearchRank(a, b) {
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
    return a.isFolder ? -1 : 1;
  }

  if ((b.displayResourceCount || 0) !== (a.displayResourceCount || 0)) {
    return (b.displayResourceCount || 0) - (a.displayResourceCount || 0);
  }

  return (a.displayName || '').localeCompare(b.displayName || '', undefined, { sensitivity: 'base' });
}

function getSortedChildren(node) {
  const children = [...node.children];

  if (!currentQuery) {
    return children;
  }

  children.sort(compareSearchRank);
  return children;
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

function countVisibleResources(node) {
  if (!node.visible) return 0;

  if (!node.isFolder) {
    return 1;
  }

  if (node.restricted && typeof node.sourceCount === 'number') {
    return node.sourceCount;
  }

  return node.children.reduce((sum, child) => sum + countVisibleResources(child), 0);
}

function renderStats() {
  const categoryCount = allNodes.filter(n => n.isFolder && n !== root).length;
  const linkCount = root ? root.displayResourceCount : 0;
  const accountCount = allNodes.filter(n => !n.isFolder && n.requiresAccount).length;

  statCategories.textContent = String(categoryCount);
  statLinks.textContent = String(linkCount);
  statAccount.textContent = String(accountCount);

  const visibleResources = root ? countVisibleResources(root) : 0;

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
  const safeUrl = sanitizeExternalUrl(url);
  if (!safeUrl) return '';
  return `<a class="${className}" href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer">${escapeHtml(text)}</a>`;
}

function renderInlineNodeDetails(node) {
  if (node.isFolder) {
    return `
      <div class="inline-node-details__body">
        <div class="inline-node-details__meta">
          <span class="badge category-meta">${node.displayResourceCount} resource${node.displayResourceCount === 1 ? '' : 's'}</span>
          <span class="badge category-meta">${node.categoryCount} subcategor${node.categoryCount === 1 ? 'y' : 'ies'}</span>
          ${node.restricted && typeof node.sourceCount === 'number'
            ? `<span class="badge restricted-badge">Placeholder count: ${node.sourceCount}</span>`
            : ''}
        </div>
      </div>
    `;
  }

  const verificationMeta = getVerificationMeta(node);
  const verificationBadge = `<span class="${verificationMeta.className}" title="${escapeHtml(verificationMeta.title)}">${escapeHtml(verificationMeta.shortLabel)}</span>`;

  const verifiedDateBadge = node.lastVerified
    ? `<span class="badge">Last verified: ${escapeHtml(node.lastVerified)}</span>`
    : '';

  const accountBadge = node.requiresAccount
    ? '<span class="badge account">Account required</span>'
    : '<span class="badge">No account required</span>';

  const restrictedBadge = node.restricted
    ? '<span class="badge restricted-badge">Restricted placeholder</span>'
    : '';

  const insecureUrlBadge = node.isInsecureUrl
    ? '<span class="badge insecure-link">HTTP link</span>'
    : '';

  const urlActions = node.url
    ? `
      <div class="inline-node-details__actions">
        ${buildActionLink(node.url, 'Open resource', 'primary-link')}
        ${buildActionLink(node.url, 'Open in new tab', 'secondary-btn')}
      </div>
    `
    : `
      <div class="inline-node-details__actions">
        <span class="secondary-btn secondary-btn--disabled" aria-disabled="true">Invalid or unsupported URL</span>
      </div>
    `;

  return `
    <div class="inline-node-details__body">
      <p class="inline-node-details__description">
        ${escapeHtml(node.displayDescription || 'No description provided.')}
      </p>
      <div class="inline-node-details__meta">
        ${accountBadge}
        ${verificationBadge}
        ${verifiedDateBadge}
        ${restrictedBadge}
        ${insecureUrlBadge}
      </div>
      ${urlActions}
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

function focusNodeLabel(nodeId) {
  requestAnimationFrame(() => {
    const target = treeContainer.querySelector(`.node-label[data-node-id="${CSS.escape(nodeId)}"]`);
    if (target) {
      target.focus();
    }
  });
}

function getVisibleNodeLabels() {
  return [...treeContainer.querySelectorAll('.node-label')].filter(el => {
    const treeNode = el.closest('.tree-node');
    return treeNode && !treeNode.classList.contains('hidden');
  });
}

function getNodeById(nodeId) {
  return allNodes.find(node => node.id === nodeId) || null;
}

function handleTreeKeyboardNavigation(event) {
  const target = event.target;
  if (!target.classList.contains('node-label')) return;

  const nodeId = target.dataset.nodeId;
  const node = getNodeById(nodeId);
  if (!node) return;

  const visibleLabels = getVisibleNodeLabels();
  const currentIndex = visibleLabels.indexOf(target);

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      if (currentIndex < visibleLabels.length - 1) {
        visibleLabels[currentIndex + 1].focus();
      }
      break;

    case 'ArrowUp':
      event.preventDefault();
      if (currentIndex > 0) {
        visibleLabels[currentIndex - 1].focus();
      }
      break;

    case 'Home':
      event.preventDefault();
      if (visibleLabels.length > 0) {
        visibleLabels[0].focus();
      }
      break;

    case 'End':
      event.preventDefault();
      if (visibleLabels.length > 0) {
        visibleLabels[visibleLabels.length - 1].focus();
      }
      break;

    case 'ArrowRight':
      event.preventDefault();
      if (node.isFolder && !expanded.has(node.id)) {
        expanded.add(node.id);
        render();
        focusNodeLabel(node.id);
      } else if (node.isFolder) {
        const firstChild = getSortedChildren(node).find(child => child.visible);
        if (firstChild) {
          focusNodeLabel(firstChild.id);
        }
      } else if (!openInlineIds.has(node.id)) {
        openInlineIds.add(node.id);
        render();
        focusNodeLabel(node.id);
      }
      break;

    case 'ArrowLeft':
      event.preventDefault();
      if (node.isFolder && expanded.has(node.id)) {
        expanded.delete(node.id);
        render();
        focusNodeLabel(node.id);
      } else if (openInlineIds.has(node.id)) {
        openInlineIds.delete(node.id);
        render();
        focusNodeLabel(node.id);
      } else if (node.parent) {
        focusNodeLabel(node.parent.id);
      }
      break;

    case 'Enter':
    case ' ':
      event.preventDefault();
      target.click();
      break;

    default:
      break;
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
      focusNodeLabel(node.id);
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
  label.dataset.nodeId = node.id;
  label.setAttribute('aria-expanded', node.isFolder ? String(expanded.has(node.id)) : String(openInlineIds.has(node.id)));
  if (selectedId === node.id) {
    label.setAttribute('aria-current', 'true');
  }
  label.innerHTML = highlight(node.displayName || node.name || '', currentQuery);

  label.addEventListener('click', event => {
    event.preventDefault();
    selectedId = node.id;

    if (node.isFolder) {
      expanded.add(node.id);
    }

    toggleInlineCard(node);
    render();
    focusNodeLabel(node.id);
  });

  row.appendChild(label);

  if (node.isFolder) {
    appendBadge(
      row,
      'badge category-meta',
      `${node.displayResourceCount} resource${node.displayResourceCount === 1 ? '' : 's'}`,
      `${node.displayResourceCount} resource${node.displayResourceCount === 1 ? '' : 's'} inside this category`
    );

    appendBadge(
      row,
      'badge category-meta',
      `${node.categoryCount} subcategor${node.categoryCount === 1 ? 'y' : 'ies'}`,
      `${node.categoryCount} subcategor${node.categoryCount === 1 ? 'y' : 'ies'} inside this category`
    );

    if (node.restricted && typeof node.sourceCount === 'number') {
      appendBadge(
        row,
        'badge restricted-badge',
        `Restricted count: ${node.sourceCount}`,
        `Restricted placeholder count from source: ${node.sourceCount}`
      );
    }
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

    if (node.isInsecureUrl) {
      appendBadge(row, 'badge insecure-link', 'HTTP', 'This resource uses HTTP, not HTTPS');
    }

    if (node.url) {
      const openBtn = document.createElement('a');
      openBtn.className = 'tree-open-btn';
      openBtn.href = node.url;
      openBtn.target = '_blank';
      openBtn.rel = 'noreferrer noopener';
      openBtn.referrerPolicy = 'no-referrer';
      openBtn.textContent = 'Open';
      row.appendChild(openBtn);
    } else {
      const invalidBadge = document.createElement('span');
      invalidBadge.className = 'badge invalid-link';
      invalidBadge.textContent = 'Invalid URL';
      row.appendChild(invalidBadge);
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

    getSortedChildren(node).forEach(child => {
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
          <span class="badge category-meta">3 subcategories</span>
          <span>Category contains this many nested categories.</span>
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
        <div class="legend-item">
          <span class="badge insecure-link">HTTP</span>
          <span>The resource uses HTTP instead of HTTPS.</span>
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

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

function collectVisibleExportRows(node, rows = []) {
  if (!node.visible) {
    return rows;
  }

  if (node.isFolder) {
    if (node.restricted && typeof node.sourceCount === 'number') {
      rows.push({
        category: getNodePath(node),
        name: 'Restricted Placeholder',
        url: '',
        description: node.displayDescription || 'Restricted placeholder category',
        requiresAccount: '',
        lastVerified: '',
        restricted: 'Yes',
        resources: node.displayResourceCount,
        subcategories: node.categoryCount
      });
      return rows;
    }

    node.children.forEach(child => collectVisibleExportRows(child, rows));
    return rows;
  }

  rows.push({
    category: getNodeCategoryPath(node),
    name: node.displayName || '',
    url: node.url || '',
    description: node.displayDescription || '',
    requiresAccount: node.requiresAccount ? 'Yes' : 'No',
    lastVerified: node.lastVerified || '',
    restricted: node.restricted ? 'Yes' : 'No',
    resources: '',
    subcategories: ''
  });

  return rows;
}

function exportVisibleResultsToMarkdown() {
  if (!root) return;

  const rows = collectVisibleExportRows(root, []);
  const lines = [];

  lines.push('# Visible Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');

  lines.push('| Category | Name | URL | Description | Account Required | Last Verified | Restricted |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  rows.forEach(row => {
    lines.push(
      `| ${escapeHtml(row.category || '')} | ${escapeHtml(row.name || '')} | ${escapeHtml(row.url || '')} | ${escapeHtml(String(row.description || '').replace(/\|/g, '\\|'))} | ${escapeHtml(row.requiresAccount || '')} | ${escapeHtml(row.lastVerified || '')} | ${escapeHtml(row.restricted || '')} |`
    );
  });

  downloadTextFile('visible-results.md', lines.join('\n'), 'text/markdown;charset=utf-8');
}

function csvEscape(value) {
  const safeValue = csvSafe(value);
  const stringValue = String(safeValue ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }
  return stringValue;
}

function exportVisibleResultsToCsv() {
  if (!root) return;

  const rows = collectVisibleExportRows(root, []);
  const header = [
    'Category',
    'Name',
    'URL',
    'Description',
    'Account Required',
    'Last Verified',
    'Restricted',
    'Resources',
    'Subcategories'
  ];

  const lines = [header.join(',')];

  rows.forEach(row => {
    lines.push([
      row.category,
      row.name,
      row.url,
      row.description,
      row.requiresAccount,
      row.lastVerified,
      row.restricted,
      row.resources,
      row.subcategories
    ].map(csvEscape).join(','));
  });

  downloadTextFile('visible-results.csv', lines.join('\n'), 'text/csv;charset=utf-8');
}

function normalizeBuildMeta(input) {
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_BUILD_META };
  }

  return {
    version: normalizeString(input.version || DEFAULT_BUILD_META.version, DEFAULT_BUILD_META.version),
    pushedAt: normalizeString(input.pushedAt || DEFAULT_BUILD_META.pushedAt, DEFAULT_BUILD_META.pushedAt),
    commit: normalizeString(input.commit || DEFAULT_BUILD_META.commit),
    shortSha: normalizeString(input.shortSha || DEFAULT_BUILD_META.shortSha),
    runNumber: normalizeString(String(input.runNumber ?? DEFAULT_BUILD_META.runNumber)),
    sourceRepo: normalizeString(input.sourceRepo || DEFAULT_BUILD_META.sourceRepo),
    sourceRef: normalizeString(input.sourceRef || DEFAULT_BUILD_META.sourceRef),
    sourceSha: normalizeString(input.sourceSha || DEFAULT_BUILD_META.sourceSha),
    sourceShortSha: normalizeString(input.sourceShortSha || DEFAULT_BUILD_META.sourceShortSha)
  };
}

async function loadBuildMeta() {
  try {
    const response = await fetch('./data/build-meta.json', { cache: 'no-store' });
    if (!response.ok) {
      buildMeta = { ...DEFAULT_BUILD_META };
      return;
    }

    const json = await response.json();
    buildMeta = normalizeBuildMeta(json);
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

  const sourceLine = buildMeta.sourceShortSha
    ? `Source ${escapeHtml(buildMeta.sourceShortSha)}`
    : (buildMeta.sourceRepo ? escapeHtml(buildMeta.sourceRepo) : 'Source unknown');

  const titleParts = [];
  if (buildMeta.commit) titleParts.push(`Build commit: ${buildMeta.commit}`);
  if (buildMeta.runNumber) titleParts.push(`Run: ${buildMeta.runNumber}`);
  if (buildMeta.sourceSha) titleParts.push(`Source commit: ${buildMeta.sourceSha}`);
  if (buildMeta.sourceRef) titleParts.push(`Source ref: ${buildMeta.sourceRef}`);
  badge.title = titleParts.join(' • ');

  badge.innerHTML = `
    <div class="build-badge__version">${escapeHtml(buildMeta.version)}</div>
    <div class="build-badge__time">${escapeHtml(buildMeta.pushedAt)}</div>
    <div class="build-badge__source">${sourceLine}</div>
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

    if (exportCsvBtn && exportCsvBtn.parentElement) {
      exportCsvBtn.insertAdjacentElement('afterend', shareBtn);
    } else if (clearSearchBtn && clearSearchBtn.parentElement) {
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

function assertRequiredDom() {
  const required = [
    ['treeContainer', treeContainer],
    ['detailsContainer', detailsContainer],
    ['searchInput', searchInput],
    ['accountFilter', accountFilter],
    ['clearSearchBtn', clearSearchBtn],
    ['expandAllBtn', expandAllBtn],
    ['collapseAllBtn', collapseAllBtn],
    ['themeToggleBtn', themeToggleBtn],
    ['treeStatus', treeStatus],
    ['exportMarkdownBtn', exportMarkdownBtn],
    ['exportCsvBtn', exportCsvBtn],
    ['statCategories', statCategories],
    ['statLinks', statLinks],
    ['statAccount', statAccount]
  ];

  const missing = required.filter(([, el]) => !el).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Missing required DOM element(s): ${missing.join(', ')}`);
  }
}

async function init() {
  assertRequiredDom();

  const response = await fetch('./data/tree.json', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Failed to load tree.json (${response.status} ${response.statusText})`);
  }

  const data = await response.json();

  allNodes.length = 0;
  idCounter = 0;
  selectedId = null;
  openInlineIds = new Set();

  const normalizedRoot = normalizeTreeNode(data, null, 0, { count: 0 });
  if (!normalizedRoot) {
    throw new Error('tree.json could not be normalized');
  }

  root = normalizedRoot;
  computeDerivedStats(root);
  resetExpansion();
  applyThemePreference();
  await loadBuildMeta();
  renderLegendOnly();
  ensureBuildMetaPlacement();
  ensureShareButton();
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

exportMarkdownBtn.addEventListener('click', exportVisibleResultsToMarkdown);
exportCsvBtn.addEventListener('click', exportVisibleResultsToCsv);

treeContainer.addEventListener('keydown', handleTreeKeyboardNavigation);

document.addEventListener('keydown', event => {
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
  if (treeContainer) {
    treeContainer.innerHTML = `<div class="details-card"><h3>Could not load data</h3><p>${escapeHtml(String(error))}</p></div>`;
  }
});
