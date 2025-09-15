import { showToast } from './toast.js';

class GmailError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'GmailError';
    this.status = status;
    this.payload = payload;
  }
}

class GmailClient {
  constructor(getToken) {
    this.getToken = getToken;
  }

  async _request(path, options = {}) {
    const token = await this.getToken();
    if (!token) {
      throw new GmailError('Missing Gmail access token', 401);
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    };
    const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...options,
      headers
    });
    if (!resp.ok) {
      let detail = null;
      try {
        detail = await resp.json();
      } catch (err) {
        try {
          detail = await resp.text();
        } catch (err2) {
          detail = null;
        }
      }
      const message =
        (detail && detail.error && detail.error.message) ||
        (typeof detail === 'string' && detail) ||
        resp.statusText ||
        'Gmail request failed';
      throw new GmailError(message, resp.status, detail);
    }
    if (resp.status === 204) return {};
    try {
      return await resp.json();
    } catch (err) {
      return {};
    }
  }

  async listThreads(params = {}) {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.append(key, value);
    });
    const qs = search.toString();
    return this._request(`threads${qs ? `?${qs}` : ''}`);
  }

  async getThread(id, params = {}) {
    const search = new URLSearchParams({ format: 'full' });
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.append(key, value);
    });
    const qs = search.toString();
    return this._request(`threads/${id}${qs ? `?${qs}` : ''}`);
  }

  async listLabels() {
    return this._request('labels');
  }

  async getProfile() {
    return this._request('profile');
  }

  async modifyThread(id, addLabelIds = [], removeLabelIds = []) {
    return this._request(`threads/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds, removeLabelIds })
    });
  }

  async modifyMessage(id, addLabelIds = [], removeLabelIds = []) {
    return this._request(`messages/${id}/modify`, {
      method: 'POST',
      body: JSON.stringify({ addLabelIds, removeLabelIds })
    });
  }

  async trashThread(id) {
    return this._request(`threads/${id}/trash`, {
      method: 'POST',
      body: '{}'
    });
  }

  async sendMessage(raw, { threadId = null, useDraft = false } = {}) {
    const payload = threadId ? { raw, threadId } : { raw };
    if (useDraft) {
      const draft = await this._request('drafts', {
        method: 'POST',
        body: JSON.stringify({ message: payload })
      });
      const draftId = draft?.id || draft?.draft?.id;
      return this._request('drafts/send', {
        method: 'POST',
        body: JSON.stringify(
          draftId
            ? { id: draftId }
            : { message: payload }
        )
      });
    }
    return this._request('messages/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async getAttachment(messageId, attachmentId) {
    return this._request(`messages/${messageId}/attachments/${attachmentId}`);
  }
}

const textDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;

function decodeBase64(data) {
  if (!data) return new Uint8Array();
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = normalized + (pad ? '='.repeat(4 - pad) : '');
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function decodeBody(data) {
  if (!data) return '';
  const bytes = decodeBase64(data);
  if (textDecoder) {
    try {
      return textDecoder.decode(bytes);
    } catch (err) {
      /* ignore and fall back */
    }
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  try {
    return decodeURIComponent(escape(binary));
  } catch (err) {
    return binary;
  }
}

function base64UrlEncode(str) {
  const utf8 = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < utf8.length; i += chunk) {
    const slice = utf8.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function wrapBase64(str) {
  const chunk = 76;
  const parts = [];
  for (let i = 0; i < str.length; i += chunk) {
    parts.push(str.slice(i, i + chunk));
  }
  return parts.join('\r\n');
}

function sanitizeHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return html || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,link').forEach(el => el.remove());
  doc.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (/^on/i.test(attr.name) || attr.name === 'style') {
        el.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML || '';
}

function stripHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return html || '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

function parseHeaders(headers = []) {
  const map = {};
  headers.forEach(h => {
    if (!h?.name) return;
    map[h.name.toLowerCase()] = h.value || '';
  });
  return map;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatListDate(date) {
  if (!date) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString();
}

function formatFullDate(date) {
  if (!date) return '';
  return date.toLocaleString();
}

function formatSize(bytes) {
  if (bytes === undefined || bytes === null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ensurePrefix(subject, prefix) {
  if (!subject) return `${prefix} (no subject)`;
  return subject.toLowerCase().startsWith(prefix.toLowerCase()) ? subject : `${prefix} ${subject}`;
}

function senderName(value) {
  if (!value) return '';
  const match = value.match(/"?([^"<]*)"?\s*<([^>]+)>/);
  if (match) {
    const name = match[1].trim();
    return name || match[2];
  }
  return value;
}

function createPlaceholder(text) {
  const el = document.createElement('div');
  el.className = 'emails-placeholder';
  el.textContent = text;
  return el;
}

function createLoadingIndicator(text) {
  const wrap = document.createElement('div');
  wrap.className = 'emails-loading';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  wrap.appendChild(spinner);
  const span = document.createElement('span');
  span.textContent = text;
  wrap.appendChild(span);
  return wrap;
}

function parseAddressList(value) {
  if (!value) return [];
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/<([^>]+)>/);
      return match ? match[1] : part.replace(/"/g, '');
    });
}

function dedupeEmails(list) {
  const seen = new Set();
  return list.filter(email => {
    const key = email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function quotedReply(message) {
  const dateText = formatFullDate(message.date);
  const body = message.body.text || stripHtml(message.body.html) || message.snippet || '';
  const quoted = body
    .split('\n')
    .map(line => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
  return `\n\nOn ${dateText} ${message.from} wrote:\n${quoted}`;
}

function forwardedBody(message) {
  const parts = [
    '---------- Forwarded message ---------',
    `From: ${message.from || ''}`,
    `Date: ${formatFullDate(message.date)}`,
    `Subject: ${message.subject || ''}`,
    `To: ${message.to || ''}`
  ];
  const body = message.body.text || stripHtml(message.body.html) || message.snippet || '';
  return `${parts.join('\n')}` + `\n\n${body}`;
}

async function buildMimeMessage({
  to,
  cc,
  bcc,
  subject,
  body,
  attachments,
  from,
  inReplyTo,
  references
}) {
  const headers = [];
  if (to) headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  if (bcc) headers.push(`Bcc: ${bcc}`);
  if (from) headers.push(`From: ${from}`);
  if (subject) headers.push(`Subject: ${subject}`);
  headers.push('MIME-Version: 1.0');
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  if (!attachments.length) {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    headers.push('Content-Transfer-Encoding: 7bit');
    headers.push('');
    headers.push(body || '');
    return base64UrlEncode(headers.join('\r\n'));
  }

  const boundary = `mixed_${Math.random().toString(36).slice(2)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  headers.push('');
  headers.push(`--${boundary}`);
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 7bit');
  headers.push('');
  headers.push(body || '');
  headers.push('');

  for (const file of attachments) {
    const base64 = await fileToBase64(file);
    headers.push(`--${boundary}`);
    headers.push(`Content-Type: ${file.type || 'application/octet-stream'}; name="${file.name}"`);
    headers.push(`Content-Disposition: attachment; filename="${file.name}"`);
    headers.push('Content-Transfer-Encoding: base64');
    headers.push('');
    headers.push(wrapBase64(base64));
    headers.push('');
  }

  headers.push(`--${boundary}--`);
  return base64UrlEncode(headers.join('\r\n'));
}
function parseMessageDetail(message) {
  const headers = parseHeaders(message?.payload?.headers || []);
  const attachments = [];
  let htmlBody = '';
  let textBody = '';

  function traverse(part) {
    if (!part) return;
    const mimeType = part.mimeType || '';
    if (part.filename && part.body && part.body.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType,
        size: part.body.size,
        attachmentId: part.body.attachmentId
      });
    }
    const data = part.body?.data;
    if (data) {
      const decoded = decodeBody(data);
      if (mimeType === 'text/html') htmlBody += decoded;
      else if (mimeType === 'text/plain') textBody += decoded;
      else if (!part.filename && !mimeType) textBody += decoded;
    }
    if (part.parts) part.parts.forEach(traverse);
  }

  traverse(message.payload);
  if (!htmlBody && !textBody && message.payload?.body?.data) {
    const decoded = decodeBody(message.payload.body.data);
    if ((message.payload.mimeType || '').includes('html')) htmlBody = decoded;
    else textBody = decoded;
  }

  const dateHeader = headers['date'];
  const headerDate = parseDate(dateHeader);
  const internalDate = message.internalDate ? Number(message.internalDate) : headerDate?.getTime();

  return {
    id: message.id,
    threadId: message.threadId,
    subject: headers['subject'] || '',
    from: headers['from'] || '',
    to: headers['to'] || '',
    cc: headers['cc'] || '',
    bcc: headers['bcc'] || '',
    replyTo: headers['reply-to'] || '',
    date: internalDate ? new Date(internalDate) : headerDate,
    internalDate: internalDate || Date.now(),
    snippet: message.snippet || '',
    labelIds: message.labelIds || [],
    body: { html: htmlBody, text: textBody },
    attachments,
    headers,
    messageId: headers['message-id'] || '',
    references: headers['references'] || ''
  };
}

function normalizeThread(thread) {
  const messages = (thread.messages || []).map(parseMessageDetail);
  messages.sort((a, b) => (a.internalDate || 0) - (b.internalDate || 0));
  const last = messages[messages.length - 1] || null;
  const isUnread = messages.some(msg => (msg.labelIds || []).includes('UNREAD'));
  const isStarred = messages.some(msg => (msg.labelIds || []).includes('STARRED'));
  const labelIds = Array.from(new Set(messages.flatMap(msg => msg.labelIds || [])));
  return {
    id: thread.id,
    historyId: thread.historyId,
    snippet: thread.snippet || last?.snippet || '',
    subject: last?.subject || '',
    lastMessage: last,
    messages,
    isUnread,
    isStarred,
    labelIds,
    latestInternalDate: last?.internalDate || 0
  };
}
export function createEmailsView({ getToken, requestToken, onToken, authFetch, apiBaseUrl }) {
  const gmail = new GmailClient(getToken);
  const state = {
    threads: [],
    selectedThreadId: null,
    labels: [],
    profile: null,
    loading: false,
    syncing: false
  };

  const root = document.createElement('div');
  root.className = 'emails-page';

  const header = document.createElement('div');
  header.className = 'emails-header';
  const headerLeft = document.createElement('div');
  headerLeft.className = 'emails-header-left';
  const headerRight = document.createElement('div');
  headerRight.className = 'emails-header-right';

  const connectBtn = document.createElement('button');
  connectBtn.type = 'button';
  connectBtn.className = 'emails-connect';
  connectBtn.textContent = 'Connect Gmail';
  connectBtn.addEventListener('click', () => {
    if (requestToken) requestToken();
  });

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'emails-refresh';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', () => {
    loadThreads(true);
  });

  const syncBtn = document.createElement('button');
  syncBtn.type = 'button';
  syncBtn.className = 'emails-sync';
  syncBtn.textContent = 'Clean & Sync';
  syncBtn.addEventListener('click', () => {
    handleSync();
  });

  const syncStatusEl = document.createElement('div');
  syncStatusEl.className = 'emails-sync-status';

  headerLeft.append(connectBtn, refreshBtn, syncBtn);
  headerRight.append(syncStatusEl);
  header.append(headerLeft, headerRight);

  const layout = document.createElement('div');
  layout.className = 'emails-layout';

  const listPane = document.createElement('div');
  listPane.className = 'emails-thread-list';
  const list = document.createElement('div');
  list.className = 'emails-thread-items';
  listPane.appendChild(list);

  const detailPane = document.createElement('div');
  detailPane.className = 'emails-thread-detail';
  detailPane.appendChild(createPlaceholder('Select a conversation to read.'));

  layout.append(listPane, detailPane);

  const composeBtn = document.createElement('button');
  composeBtn.type = 'button';
  composeBtn.className = 'emails-compose-btn';
  composeBtn.textContent = 'Compose';
  composeBtn.addEventListener('click', () => {
    if (!ensureAuthorized(false)) {
      if (requestToken) requestToken();
      return;
    }
    openCompose({ mode: 'compose' });
  });

  root.append(header, layout, composeBtn);

  const composeOverlay = document.createElement('div');
  composeOverlay.className = 'emails-compose-overlay hidden';
  composeOverlay.innerHTML = `
    <form class="emails-compose-form glass">
      <div class="emails-compose-bar">
        <h2 class="emails-compose-title">New Message</h2>
        <button type="button" class="emails-compose-close" aria-label="Close">×</button>
      </div>
      <label>To<input name="to" type="text" required placeholder="recipient@example.com" /></label>
      <label>Cc<input name="cc" type="text" placeholder="" /></label>
      <label>Bcc<input name="bcc" type="text" placeholder="" /></label>
      <label>Subject<input name="subject" type="text" placeholder="Subject" /></label>
      <label>Message<textarea name="body" rows="10" placeholder="Write your message"></textarea></label>
      <div class="emails-compose-attachments">
        <label class="emails-attachment-input">Attachments<input type="file" name="attachments" multiple /></label>
        <div class="emails-compose-attachment-list"></div>
      </div>
      <div class="emails-compose-actions">
        <button type="submit" class="emails-send">Send</button>
        <button type="button" class="emails-compose-cancel">Cancel</button>
      </div>
    </form>
  `;
  document.body.appendChild(composeOverlay);

  const composeForm = composeOverlay.querySelector('form');
  const composeTitle = composeOverlay.querySelector('.emails-compose-title');
  const attachmentsList = composeOverlay.querySelector('.emails-compose-attachment-list');
  const fileInput = composeOverlay.querySelector('input[type="file"]');
  const toInput = composeOverlay.querySelector('input[name="to"]');
  const ccInput = composeOverlay.querySelector('input[name="cc"]');
  const bccInput = composeOverlay.querySelector('input[name="bcc"]');
  const subjectInput = composeOverlay.querySelector('input[name="subject"]');
  const bodyInput = composeOverlay.querySelector('textarea[name="body"]');
  const sendBtn = composeOverlay.querySelector('.emails-send');
  const closeBtn = composeOverlay.querySelector('.emails-compose-close');
  const cancelBtn = composeOverlay.querySelector('.emails-compose-cancel');

  let composeAttachments = [];
  let composeContext = { mode: 'compose', message: null, thread: null };
  let initPromise = null;
  let initializing = false;

  closeBtn.addEventListener('click', closeCompose);
  cancelBtn.addEventListener('click', closeCompose);
  composeOverlay.addEventListener('click', evt => {
    if (evt.target === composeOverlay) closeCompose();
  });

  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape' && composeOverlay.classList.contains('visible')) {
      closeCompose();
    }
  });

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) {
      composeAttachments = composeAttachments.concat(files);
      renderComposeAttachments();
      fileInput.value = '';
    }
  });

  composeForm.addEventListener('submit', async evt => {
    evt.preventDefault();
    await sendMessageFromCompose();
  });

  onToken(() => {
    updateAuthButtons();
    handleTokenReady();
  });

  updateAuthButtons();
  if (getToken()) {
    handleTokenReady();
  } else {
    renderDisconnectedState();
  }

  function renderComposeAttachments() {
    attachmentsList.innerHTML = '';
    if (!composeAttachments.length) {
      return;
    }
    composeAttachments.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'emails-compose-attachment';
      const info = document.createElement('span');
      info.textContent = `${file.name} (${formatSize(file.size)})`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'emails-compose-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        composeAttachments.splice(index, 1);
        renderComposeAttachments();
      });
      item.append(info, remove);
      attachmentsList.appendChild(item);
    });
  }

  function closeCompose() {
    composeOverlay.classList.add('hidden');
    composeOverlay.classList.remove('visible');
    composeForm.reset();
    composeAttachments = [];
    attachmentsList.innerHTML = '';
    composeContext = { mode: 'compose', message: null, thread: null };
  }

  function openCompose({ mode = 'compose', message = null, thread = null }) {
    composeContext = { mode, message, thread };
    composeOverlay.classList.remove('hidden');
    composeOverlay.classList.add('visible');
    composeAttachments = [];
    attachmentsList.innerHTML = '';
    composeForm.reset();

    const userEmail = state.profile?.emailAddress || '';
    let defaultSubject = '';
    let defaultBody = '';
    let toValue = '';
    let ccValue = '';

    if (mode === 'reply' || mode === 'replyAll') {
      if (message) {
        defaultSubject = ensurePrefix(message.subject, 'Re:');
        defaultBody = quotedReply(message);
        const replyTargets = parseAddressList(message.replyTo || message.from || '');
        const initialTo = dedupeEmails(replyTargets);
        toValue = initialTo.filter(addr => addr.toLowerCase() !== userEmail.toLowerCase()).join(', ');
        if (mode === 'replyAll') {
          const others = dedupeEmails([
            ...parseAddressList(message.to || ''),
            ...parseAddressList(message.cc || '')
          ]);
          const filtered = others.filter(addr => addr.toLowerCase() !== userEmail.toLowerCase());
          const toSet = new Set(initialTo.map(addr => addr.toLowerCase()));
          const ccRecipients = filtered.filter(addr => !toSet.has(addr.toLowerCase()));
          if (!toValue) {
            toValue = filtered.shift() || '';
          }
          ccValue = dedupeEmails(ccRecipients).join(', ');
        }
      }
    } else if (mode === 'forward') {
      if (message) {
        defaultSubject = ensurePrefix(message.subject, 'Fwd:');
        defaultBody = forwardedBody(message);
      }
    }

    composeTitle.textContent =
      mode === 'reply'
        ? 'Reply'
        : mode === 'replyAll'
        ? 'Reply all'
        : mode === 'forward'
        ? 'Forward'
        : 'New Message';

    toInput.value = toValue;
    ccInput.value = ccValue;
    bccInput.value = '';
    subjectInput.value = defaultSubject;
    bodyInput.value = defaultBody;

    setTimeout(() => {
      if (toInput.value) bodyInput.focus();
      else toInput.focus();
    }, 50);
  }

  function ensureAuthorized(showPlaceholders = true) {
    const token = getToken();
    if (!token) {
      if (showPlaceholders) renderDisconnectedState();
      return false;
    }
    return true;
  }
  function renderDisconnectedState() {
    list.innerHTML = '';
    list.appendChild(createPlaceholder('Connect your Gmail account to load messages.'));
    detailPane.innerHTML = '';
    detailPane.appendChild(createPlaceholder('No conversation selected.'));
    composeBtn.disabled = true;
    refreshBtn.disabled = true;
    setSyncStatus('');
  }

  function updateAuthButtons() {
    const hasToken = Boolean(getToken());
    connectBtn.textContent = hasToken ? 'Reconnect Gmail' : 'Connect Gmail';
    composeBtn.disabled = !hasToken;
    refreshBtn.disabled = !hasToken || state.loading;
    if (!hasToken) {
      state.threads = [];
      state.selectedThreadId = null;
    }
  }

  function setSyncStatus(text) {
    syncStatusEl.textContent = text || '';
  }

  function setSyncing(isSyncing, message) {
    state.syncing = isSyncing;
    syncBtn.disabled = isSyncing;
    syncBtn.classList.toggle('loading', isSyncing);
    syncBtn.textContent = isSyncing ? 'Syncing…' : 'Clean & Sync';
    if (message) setSyncStatus(message);
    if (!isSyncing && !message) setSyncStatus('');
  }

  async function handleSync() {
    if (!apiBaseUrl) {
      showToast('API base URL is not configured');
      return;
    }
    if (!ensureAuthorized(false)) {
      showToast('Connect Gmail before syncing');
      return;
    }
    if (state.syncing) return;
    setSyncing(true, 'Syncing mailbox…');
    try {
      const resp = await authFetch(`${apiBaseUrl}/emails/gmail/clean-sync`, {
        method: 'POST'
      });
      let data = {};
      try {
        data = await resp.json();
      } catch (err) {
        data = {};
      }
      if (!resp.ok) {
        const detail = data?.detail || data?.error || 'Mailbox sync failed';
        throw new Error(detail);
      }
      const status = data?.status || 'queued';
      const lastRun = data?.last_run ? `Last sync: ${new Date(data.last_run).toLocaleString()}` : '';
      setSyncStatus(status === 'syncing' ? 'Mailbox syncing…' : lastRun || 'Mailbox sync requested');
      showToast('Mailbox sync triggered');
      await loadThreads(true);
    } catch (err) {
      console.error(err);
      const message = err?.message || 'Mailbox sync failed';
      showToast(message);
      setSyncStatus('Sync failed');
    } finally {
      setSyncing(false);
    }
  }
  async function fetchProfile() {
    try {
      state.profile = await gmail.getProfile();
    } catch (err) {
      console.warn('Failed to load Gmail profile', err);
    }
  }

  async function fetchLabels() {
    try {
      const resp = await gmail.listLabels();
      const labels = resp?.labels || [];
      state.labels = labels.filter(label => label.type === 'user');
    } catch (err) {
      console.warn('Failed to load Gmail labels', err);
      state.labels = [];
    }
  }

  async function handleTokenReady() {
    if (initializing) return initPromise;
    if (!ensureAuthorized()) return;
    initializing = true;
    initPromise = (async () => {
      list.innerHTML = '';
      list.appendChild(createLoadingIndicator('Loading mailbox…'));
      detailPane.innerHTML = '';
      detailPane.appendChild(createLoadingIndicator('Preparing messages…'));
      try {
        await Promise.all([fetchProfile(), fetchLabels()]);
        await loadThreads(false);
      } catch (err) {
        handleActionError(err, 'Failed to load mailbox');
        if (err instanceof GmailError && err.status === 401 && requestToken) {
          requestToken();
        }
      }
    })().finally(() => {
      initializing = false;
      initPromise = null;
      updateAuthButtons();
    });
    return initPromise;
  }

  async function loadThreads(preserveSelection = true) {
    if (!ensureAuthorized()) return;
    state.loading = true;
    updateAuthButtons();
    list.innerHTML = '';
    list.appendChild(createLoadingIndicator('Loading messages…'));
    try {
      const resp = await gmail.listThreads({ labelIds: 'INBOX', maxResults: 25 });
      const threads = resp?.threads || [];
      if (!threads.length) {
        state.threads = [];
        state.selectedThreadId = null;
        list.innerHTML = '';
        list.appendChild(createPlaceholder('Your inbox is empty.'));
        detailPane.innerHTML = '';
        detailPane.appendChild(createPlaceholder('No conversation selected.'));
        return;
      }
      const detailed = await Promise.all(threads.map(t => gmail.getThread(t.id)));
      const normalized = detailed.map(normalizeThread);
      normalized.sort((a, b) => (b.latestInternalDate || 0) - (a.latestInternalDate || 0));
      state.threads = normalized;
      const previous = preserveSelection ? state.selectedThreadId : null;
      if (previous && normalized.some(t => t.id === previous)) {
        state.selectedThreadId = previous;
      } else {
        state.selectedThreadId = normalized[0]?.id || null;
      }
      renderThreadList();
      const active = state.threads.find(t => t.id === state.selectedThreadId) || null;
      renderThreadDetail(active);
    } catch (err) {
      handleActionError(err, 'Unable to load messages');
      list.innerHTML = '';
      list.appendChild(createPlaceholder('Unable to load messages. Try reconnecting Gmail.'));
      if (err instanceof GmailError && err.status === 401 && requestToken) {
        requestToken();
      }
    } finally {
      state.loading = false;
      updateAuthButtons();
    }
  }
  function renderThreadList() {
    list.innerHTML = '';
    if (!ensureAuthorized(false)) {
      list.appendChild(createPlaceholder('Connect Gmail to load messages.'));
      return;
    }
    if (state.loading) {
      list.appendChild(createLoadingIndicator('Loading messages…'));
      return;
    }
    if (!state.threads.length) {
      list.appendChild(createPlaceholder('No conversations found.'));
      return;
    }
    state.threads.forEach(thread => {
      const item = document.createElement('div');
      item.className = 'emails-thread-item';
      if (thread.id === state.selectedThreadId) item.classList.add('active');
      if (thread.isUnread) item.classList.add('unread');
      if (thread.isStarred) item.classList.add('starred');

      const top = document.createElement('div');
      top.className = 'emails-thread-top';
      const nameEl = document.createElement('span');
      nameEl.className = 'emails-thread-name';
      nameEl.textContent = senderName(thread.lastMessage?.from || '(No sender)');
      const meta = document.createElement('div');
      meta.className = 'emails-thread-meta';
      const dateEl = document.createElement('span');
      dateEl.className = 'emails-thread-date';
      dateEl.textContent = formatListDate(thread.lastMessage?.date);
      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.className = 'emails-thread-star';
      starBtn.title = thread.isStarred ? 'Unstar conversation' : 'Star conversation';
      starBtn.textContent = thread.isStarred ? '★' : '☆';
      starBtn.addEventListener('click', evt => {
        evt.stopPropagation();
        toggleStar(thread, starBtn);
      });
      meta.append(dateEl, starBtn);
      top.append(nameEl, meta);

      const subjectEl = document.createElement('div');
      subjectEl.className = 'emails-thread-subject';
      subjectEl.textContent = thread.subject || '(No subject)';

      const snippetEl = document.createElement('div');
      snippetEl.className = 'emails-thread-snippet';
      snippetEl.textContent = thread.snippet || '';

      item.append(top, subjectEl, snippetEl);
      item.addEventListener('click', () => selectThread(thread.id));
      list.appendChild(item);
    });
  }

  function selectThread(id) {
    state.selectedThreadId = id;
    renderThreadList();
    const thread = state.threads.find(t => t.id === id) || null;
    renderThreadDetail(thread);
  }

  function renderThreadDetail(thread) {
    detailPane.innerHTML = '';
    if (!ensureAuthorized(false)) {
      detailPane.appendChild(createPlaceholder('Connect Gmail to read messages.'));
      return;
    }
    if (!thread) {
      detailPane.appendChild(createPlaceholder('Select a conversation to read.'));
      return;
    }

    const headerEl = document.createElement('div');
    headerEl.className = 'emails-thread-header';
    const subjectEl = document.createElement('h2');
    subjectEl.textContent = thread.subject || '(No subject)';
    headerEl.appendChild(subjectEl);

    const actions = document.createElement('div');
    actions.className = 'emails-thread-actions';

    const readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.textContent = thread.isUnread ? 'Mark as read' : 'Mark as unread';
    readBtn.addEventListener('click', async () => {
      readBtn.disabled = true;
      const add = thread.isUnread ? [] : ['UNREAD'];
      const remove = thread.isUnread ? ['UNREAD'] : [];
      await runThreadAction(thread.id, () => gmail.modifyThread(thread.id, add, remove), thread.isUnread ? 'Marked as read' : 'Marked as unread');
      readBtn.disabled = false;
    });
    actions.appendChild(readBtn);

    const starToggle = document.createElement('button');
    starToggle.type = 'button';
    starToggle.textContent = thread.isStarred ? 'Unstar' : 'Star';
    starToggle.addEventListener('click', async () => {
      starToggle.disabled = true;
      await toggleStar(thread, starToggle);
      starToggle.disabled = false;
    });
    actions.appendChild(starToggle);

    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.textContent = 'Archive';
    archiveBtn.addEventListener('click', async () => {
      archiveBtn.disabled = true;
      await runThreadAction(thread.id, () => gmail.modifyThread(thread.id, [], ['INBOX']), 'Conversation archived');
      archiveBtn.disabled = false;
    });
    actions.appendChild(archiveBtn);

    const moveSelect = document.createElement('select');
    moveSelect.className = 'emails-thread-move';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = 'Move to…';
    moveSelect.appendChild(defaultOption);
    state.labels.forEach(label => {
      const option = document.createElement('option');
      option.value = label.id;
      option.textContent = label.name;
      moveSelect.appendChild(option);
    });
    moveSelect.addEventListener('change', async evt => {
      const value = evt.target.value;
      if (!value) return;
      moveSelect.disabled = true;
      const labelName = state.labels.find(l => l.id === value)?.name || 'label';
      await runThreadAction(thread.id, () => gmail.modifyThread(thread.id, [value], ['INBOX']), `Moved to ${labelName}`);
      moveSelect.disabled = false;
      moveSelect.value = '';
    });
    actions.appendChild(moveSelect);

    const spamBtn = document.createElement('button');
    spamBtn.type = 'button';
    spamBtn.textContent = 'Spam';
    spamBtn.addEventListener('click', async () => {
      spamBtn.disabled = true;
      await runThreadAction(thread.id, () => gmail.modifyThread(thread.id, ['SPAM'], ['INBOX']), 'Marked as spam');
      spamBtn.disabled = false;
    });
    actions.appendChild(spamBtn);

    const trashBtn = document.createElement('button');
    trashBtn.type = 'button';
    trashBtn.textContent = 'Trash';
    trashBtn.addEventListener('click', async () => {
      trashBtn.disabled = true;
      await runThreadAction(thread.id, () => gmail.trashThread(thread.id), 'Conversation moved to trash');
      trashBtn.disabled = false;
    });
    actions.appendChild(trashBtn);

    headerEl.appendChild(actions);
    detailPane.appendChild(headerEl);

    if (thread.lastMessage?.from || thread.lastMessage?.to) {
      const summary = document.createElement('div');
      summary.className = 'emails-thread-summary';
      const bits = [];
      if (thread.lastMessage?.from) bits.push(`From ${thread.lastMessage.from}`);
      if (thread.lastMessage?.to) bits.push(`To ${thread.lastMessage.to}`);
      summary.textContent = bits.join(' • ');
      detailPane.appendChild(summary);
    }

    thread.messages.forEach(message => {
      const messageEl = document.createElement('article');
      messageEl.className = 'emails-message';
      if ((message.labelIds || []).includes('UNREAD')) messageEl.classList.add('unread');

      const messageHeader = document.createElement('header');
      messageHeader.className = 'emails-message-header';
      const fromEl = document.createElement('div');
      fromEl.className = 'emails-message-from';
      fromEl.textContent = message.from || '(Unknown sender)';
      const metaEl = document.createElement('div');
      metaEl.className = 'emails-message-meta';
      metaEl.textContent = formatFullDate(message.date);
      messageHeader.append(fromEl, metaEl);
      messageEl.appendChild(messageHeader);

      const recipients = [];
      if (message.to) recipients.push(`To: ${message.to}`);
      if (message.cc) recipients.push(`Cc: ${message.cc}`);
      if (message.bcc) recipients.push(`Bcc: ${message.bcc}`);
      if (recipients.length) {
        const recipientsEl = document.createElement('div');
        recipientsEl.className = 'emails-message-recipients';
        recipientsEl.textContent = recipients.join(' • ');
        messageEl.appendChild(recipientsEl);
      }

      const bodyEl = document.createElement('div');
      bodyEl.className = 'emails-message-body';
      if (message.body.html) {
        bodyEl.innerHTML = sanitizeHtml(message.body.html);
      } else {
        const pre = document.createElement('pre');
        pre.textContent = message.body.text || message.snippet || '';
        bodyEl.appendChild(pre);
      }
      messageEl.appendChild(bodyEl);

      if (message.attachments.length) {
        const attachmentsWrap = document.createElement('div');
        attachmentsWrap.className = 'emails-message-attachments';
        message.attachments.forEach(att => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'emails-attachment';
          const sizeText = att.size ? ` (${formatSize(att.size)})` : '';
          btn.textContent = `${att.filename || 'attachment'}${sizeText}`;
          btn.addEventListener('click', () => downloadAttachment(message, att, btn));
          attachmentsWrap.appendChild(btn);
        });
        messageEl.appendChild(attachmentsWrap);
      }

      messageEl.appendChild(renderMessageActions(message, thread));
      detailPane.appendChild(messageEl);
    });

    detailPane.scrollTop = 0;
  }

  function renderMessageActions(message, thread) {
    const wrap = document.createElement('div');
    wrap.className = 'emails-message-actions';
    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.textContent = 'Reply';
    replyBtn.addEventListener('click', () => openCompose({ mode: 'reply', message, thread }));
    const replyAllBtn = document.createElement('button');
    replyAllBtn.type = 'button';
    replyAllBtn.textContent = 'Reply all';
    replyAllBtn.addEventListener('click', () => openCompose({ mode: 'replyAll', message, thread }));
    const forwardBtn = document.createElement('button');
    forwardBtn.type = 'button';
    forwardBtn.textContent = 'Forward';
    forwardBtn.addEventListener('click', () => openCompose({ mode: 'forward', message, thread }));
    wrap.append(replyBtn, replyAllBtn, forwardBtn);
    return wrap;
  }
  async function runThreadAction(threadId, action, successMessage) {
    try {
      await action();
      if (successMessage) showToast(successMessage);
      await loadThreads(true);
      if (threadId) {
        const thread = state.threads.find(t => t.id === threadId) || null;
        renderThreadDetail(thread);
      }
    } catch (err) {
      handleActionError(err, 'Email action failed');
      if (err instanceof GmailError && err.status === 401 && requestToken) {
        requestToken();
      }
    }
  }

  async function toggleStar(thread, sourceButton) {
    const add = thread.isStarred ? [] : ['STARRED'];
    const remove = thread.isStarred ? ['STARRED'] : [];
    if (sourceButton) sourceButton.disabled = true;
    await runThreadAction(thread.id, () => gmail.modifyThread(thread.id, add, remove), thread.isStarred ? 'Star removed' : 'Conversation starred');
    if (sourceButton) sourceButton.disabled = false;
  }

  async function downloadAttachment(message, attachment, button) {
    if (button) {
      button.disabled = true;
      button.classList.add('loading');
    }
    try {
      const data = await gmail.getAttachment(message.id, attachment.attachmentId);
      const bytes = decodeBase64(data?.data || '');
      const blob = new Blob([bytes], { type: attachment.mimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = attachment.filename || 'attachment';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      handleActionError(err, 'Failed to download attachment');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('loading');
      }
    }
  }

  function handleActionError(err, fallback) {
    console.error(err);
    const message = err instanceof GmailError ? err.message : fallback;
    if (message) showToast(message);
  }

  async function sendMessageFromCompose() {
    if (!ensureAuthorized(false)) {
      showToast('Connect Gmail before sending messages');
      closeCompose();
      return;
    }
    const to = toInput.value.trim();
    const cc = ccInput.value.trim();
    const bcc = bccInput.value.trim();
    const subject = subjectInput.value.trim();
    const body = bodyInput.value || '';
    if (!to) {
      showToast('Recipient is required');
      toInput.focus();
      return;
    }
    sendBtn.disabled = true;
    sendBtn.classList.add('loading');
    try {
      let inReplyTo = '';
      let references = '';
      let threadId = null;
      const message = composeContext.message;
      const thread = composeContext.thread;
      if ((composeContext.mode === 'reply' || composeContext.mode === 'replyAll') && message) {
        if (message.messageId) {
          inReplyTo = message.messageId;
          references = message.references ? `${message.references} ${message.messageId}`.trim() : message.messageId;
        }
        threadId = thread?.id || message.threadId || null;
      }

      const raw = await buildMimeMessage({
        to,
        cc,
        bcc,
        subject,
        body,
        attachments: composeAttachments,
        from: state.profile?.emailAddress || '',
        inReplyTo,
        references
      });
      const useDraft = composeAttachments.length > 0;
      await gmail.sendMessage(raw, { threadId, useDraft });
      showToast('Message sent');
      closeCompose();
      await loadThreads(true);
    } catch (err) {
      handleActionError(err, 'Failed to send email');
      if (err instanceof GmailError && err.status === 401 && requestToken) {
        requestToken();
      }
    } finally {
      sendBtn.disabled = false;
      sendBtn.classList.remove('loading');
    }
  }

  return root;
}
