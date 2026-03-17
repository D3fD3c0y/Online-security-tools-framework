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
let pendingSelectedPath = '';
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
  node.restricted = Boolean(node.restricted);

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

function getSortedChildren(node) {
  const children = [...node.children];

  if (!currentQuery) {
    return children;
  }

  children.sort((a, b) => compareSearchRank(a, b, true));
  return children;
}

function buildActionLink(url, text, className) {
  if (!url) return '';
  return `<a class="${className}" href="${escapeHtml(url)}" target="_blank"
