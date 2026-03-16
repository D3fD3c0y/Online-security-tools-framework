
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

let root = null;
let idCounter = 0;
let expanded = new Set();
let selectedId = null;
let currentQuery = '';
let showNoAccountOnly = false;
const allNodes = [];

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
  const safeText = escapeHtml(text || '');
  if (!query) return safeText;
  const pattern = new RegExp(`(${regexEscape(query)})`, 'ig');
  return safeText.replace(pattern, '<mark>$1</mark>');
}

function enrichTree(node, parent = null, depth = 0) {
  node.id = `node-${idCounter++}`;
  node.parent = parent;
  node.depth = depth;
  node.isFolder = Array.isArray(node.children) && node.children.length > 0;
  node.requiresAccount = Boolean(node.requiresAccount);
  node.children = node.children || [];
  node.searchText = [node.name, node.description, node.url, node.lastVerified]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  allNodes.push(node);
  node.children.forEach(child => enrichTree(child, node, depth + 1));
  return node;
}

function evaluateMatches(node, query) {
  const selfMatches = !query || node.searchText.includes(query);
  const childMatches = node.children.some(child => evaluateMatches(child, query));
  const accountPass = !showNoAccountOnly || !node.requiresAccount;

  node.selfMatches = selfMatches;
  node.queryMatches = selfMatches || childMatches;
  node.visible = accountPass && (node.isFolder ? childMatches || selfMatches : selfMatches);

  if (node.isFolder) {
    const anyVisibleChild = node.children.some(child => child.visible);
    node.visible = accountPass && (selfMatches || anyVisibleChild || !query);
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
  const visibleCount = root ? countVisibleLinks(root) : 0;
  const accountCount = allNodes.filter(n => !n.isFolder && n.requiresAccount).length;

  statCategories.textContent = String(categoryCount);
  statLinks.textContent = String(linkCount);
  statVisible.textContent = String(visibleCount);
  statAccount.textContent = String(accountCount);

  treeStatus.textContent = currentQuery
    ? `Filtered by “${currentQuery}”`
    : (showNoAccountOnly ? 'Filtered: no-account only' : 'Showing all resources');
}

function renderDetails(node) {
  if (!node) {
    detailsContainer.className = 'details-empty';
    detailsContainer.innerHTML = '<p>Select a category or resource to inspect its metadata here.</p>';
    return;
  }

  const typeBadge = node.isFolder
    ? '<span class="badge">Category</span>'
    : '<span class="badge">Resource</span>';

  const accountBadge = node.requiresAccount
    ? '<span class="badge account">Account required</span>'
    : '<span class="badge">No account required</span>';

  const verifiedBadge = node.lastVerified
    ? `<span class="badge">Last verified: ${escapeHtml(node.lastVerified)}</span>`
    : '';

  const parentBadge = node.parent && node.parent !== root
    ? `<span class="badge">Parent: ${escapeHtml(node.parent.name)}</span>`
    : '';

  const openAction = !node.isFolder && node.url
    ? `<a class="primary-link" href="${escapeHtml(node.url)}" target="_blank" rel="noreferrer noopener">Open resource</a>`
    : '';

  detailsContainer.className = 'details-card';
  detailsContainer.innerHTML = `
    <h3 class="details-title">${escapeHtml(node.name)}</h3>
    <p class="details-description">${escapeHtml(node.description || (node.isFolder ? 'Category folder' : 'No description provided.'))}</p>
    <div class="meta-list">
      ${typeBadge}
      ${accountBadge}
      ${verifiedBadge}
      ${parentBadge}
    </div>
    <div class="details-actions">
      ${openAction}
      ${node.url ? `<a class="secondary-btn" href="${escapeHtml(node.url)}" target="_blank" rel="noreferrer noopener">Open in new tab</a>` : ''}
    </div>
  `;
}

function makeTreeNode(node) {
  const li = document.createElement('li');
  li.className = 'tree-node';
  li.dataset.id = node.id;
  if (!node.visible) li.classList.add('hidden');

  const row = document.createElement('div');
  row.className = 'tree-row';
  if (selectedId === node.id) row.classList.add('selected');

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

  const label = node.url && !node.isFolder ? document.createElement('a') : document.createElement('button');
  label.className = node.url && !node.isFolder ? 'node-link' : 'node-label';
  label.innerHTML = highlight(node.name, currentQuery);

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
    if (node.isFolder) expanded.add(node.id);
    renderDetails(node);
    render();
  });

  row.appendChild(label);

  if (node.requiresAccount) {
    const badge = document.createElement('span');
    badge.className = 'badge account';
    badge.textContent = 'Account';
    row.appendChild(badge);
  }

  if (node.lastVerified) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = node.lastVerified;
    row.appendChild(badge);
  }

  li.appendChild(row);

  if (node.isFolder) {
    const childList = document.createElement('ul');
    childList.className = 'children';
    if (!expanded.has(node.id)) childList.classList.add('collapsed');

    node.children.forEach(child => childList.appendChild(makeTreeNode(child)));
    li.appendChild(childList);
  }

  return li;
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
  if (selectedNode && !selectedNode.visible) {
    selectedId = null;
    renderDetails(null);
  }
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

  // Important reset before rebuilding tree
  allNodes.length = 0;
  idCounter = 0;

  root = enrichTree(data);
  resetExpansion();
  applyThemePreference();

  renderDetails(root);
  selectedId = root.id;
  render();
}

searchInput.addEventListener('input', () => {
  currentQuery = searchInput.value.trim().toLowerCase();
  if (!currentQuery && !showNoAccountOnly) resetExpansion();
  render();
});

accountFilter.addEventListener('change', () => {
  showNoAccountOnly = accountFilter.checked;
  if (!currentQuery && !showNoAccountOnly) resetExpansion();
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

init().catch(error => {
  treeContainer.innerHTML = `<div class="details-card"><h3>Could not load data</h3><p>${escapeHtml(String(error))}</p></div>`;
});
``
