/**
 * DropBridge Main Client Application Logic
 * Integrates WebSockets, Native Web Crypto E2EE, QR Renderer, and Glassmorphic UI
 */
document.addEventListener('DOMContentLoaded', () => {
  // Application State
  const state = {
    socket: null,
    roomCode: null,
    cryptoKey: null,
    items: [],
    filter: 'all',
    peerCount: 1
  };

  // DOM Element References
  const landingView = document.getElementById('landing-view');
  const bridgeView = document.getElementById('bridge-view');
  
  const btnCreateRoom = document.getElementById('btn-create-room');
  const btnJoinRoom = document.getElementById('btn-join-room');
  const inputRoomCode = document.getElementById('input-room-code');
  const joinError = document.getElementById('join-error');
  
  const displayRoomCode = document.getElementById('display-room-code');
  const inputShareUrl = document.getElementById('input-share-url');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnCopyLink = document.getElementById('btn-copy-link');
  const qrContainer = document.getElementById('qrcode');
  const peerCountBadge = document.getElementById('peer-count-badge');
  const peerCountText = document.getElementById('peer-count-text');
  
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
  const btnOpenTextModal = document.getElementById('btn-open-text-modal');
  
  const feedList = document.getElementById('feed-list');
  const emptyFeed = document.getElementById('empty-feed');
  const btnClearFeed = document.getElementById('btn-clear-feed');
  const filterTabs = document.querySelectorAll('.filter-tabs .tab');
  
  const textModal = document.getElementById('text-modal');
  const modalTextInput = document.getElementById('modal-text-input');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnCancelModal = document.getElementById('btn-cancel-modal');
  const btnSubmitModal = document.getElementById('btn-submit-modal');
  const toast = document.getElementById('toast');

  let qrCodeObj = null;

  // Initialize Socket.io connection
  state.socket = io();

  // Handle URL hash / parameter auto-routing on page load
  checkUrlParamsAndInit();

  // ----------------------------------------------------
  // EVENT LISTENERS: Landing Actions
  // ----------------------------------------------------
  btnCreateRoom.addEventListener('click', handleCreateRoom);
  
  btnJoinRoom.addEventListener('click', () => {
    const code = inputRoomCode.value.trim().toUpperCase();
    if (code.length < 6) {
      showJoinError('Please enter a 6-character room code.');
      return;
    }
    handleJoinRoom(code);
  });

  inputRoomCode.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') btnJoinRoom.click();
  });

  // ----------------------------------------------------
  // EVENT LISTENERS: Bridge View Copy & Actions
  // ----------------------------------------------------
  btnCopyCode.addEventListener('click', () => {
    copyToClipboard(state.roomCode);
    showToast('Room Code copied!');
  });

  btnCopyLink.addEventListener('click', () => {
    copyToClipboard(inputShareUrl.value);
    showToast('Shareable Bridge Link copied!');
  });

  // Clipboard Paste Handler
  btnPasteClipboard.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        await dropTextPayload(text.trim());
      } else {
        showToast('Clipboard is empty or contains non-text content.');
      }
    } catch (err) {
      showToast('Clipboard permission denied. Click "Drop Text" to paste manually.');
    }
  });

  // File Input Selection
  fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await processAndDropFile(files[0]);
      fileInput.value = '';
    }
  });

  // Drag and Drop Target Handlers
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;

    if (dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        await processAndDropFile(dt.files[i]);
      }
    } else {
      const text = dt.getData('text');
      if (text && text.trim()) {
        await dropTextPayload(text.trim());
      }
    }
  });

  // Text Modal Handlers
  btnOpenTextModal.addEventListener('click', () => {
    modalTextInput.value = '';
    textModal.classList.remove('hidden');
    modalTextInput.focus();
  });

  const closeModal = () => textModal.classList.add('hidden');
  btnCloseModal.addEventListener('click', closeModal);
  btnCancelModal.addEventListener('click', closeModal);

  btnSubmitModal.addEventListener('click', async () => {
    const text = modalTextInput.value.trim();
    if (text) {
      await dropTextPayload(text);
      closeModal();
    }
  });

  // Feed Filter Tabs
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.filter = tab.dataset.filter;
      renderFeed();
    });
  });

  btnClearFeed.addEventListener('click', () => {
    if (state.socket && state.roomCode) {
      state.socket.emit('clear_items', { roomCode: state.roomCode });
    }
  });

  // ----------------------------------------------------
  // SOCKET.IO EVENT HANDLERS
  // ----------------------------------------------------
  state.socket.on('connect', () => {
    if (state.roomCode) {
      state.socket.emit('join_room', { roomCode: state.roomCode }, (res) => {
        if (res && res.peerCount) {
          state.peerCount = res.peerCount;
          peerCountBadge.classList.remove('hidden');
          peerCountText.textContent = res.peerCount === 1 ? '1 Device Connected' : `${res.peerCount} Devices Connected`;
        }
      });
    }
  });

  state.socket.on('peer_update', ({ peerCount }) => {
    state.peerCount = peerCount;
    peerCountBadge.classList.remove('hidden');
    peerCountText.textContent = peerCount === 1 ? '1 Device Connected' : `${peerCount} Devices Connected`;
  });

  state.socket.on('item_dropped', async (item) => {
    await decryptAndAddItem(item);
  });

  state.socket.on('items_cleared', () => {
    state.items = [];
    renderFeed();
    showToast('Feed cleared.');
  });

  state.socket.on('room_destroyed', ({ reason }) => {
    showToast(`Bridge expired (${reason}).`);
    setTimeout(() => {
      window.location.href = window.location.origin;
    }, 2000);
  });

  // ----------------------------------------------------
  // CORE WORKFLOW CONTROLLERS
  // ----------------------------------------------------

  async function handleCreateRoom() {
    try {
      btnCreateRoom.disabled = true;
      const res = await fetch('/api/create-room', { method: 'POST' });
      const data = await res.json();
      if (!data.roomCode) throw new Error('Failed to generate room code');

      // Fetch local IP info to ensure QR codes work for mobile devices over Wi-Fi
      let hostOrigin = window.location.origin;
      try {
        const infoRes = await fetch('/api/server-info');
        const infoData = await infoRes.json();
        if (infoData.localIp && window.location.hostname === 'localhost') {
          hostOrigin = `http://${infoData.localIp}:${infoData.port}`;
        }
      } catch (e) {
        console.warn('Could not fetch server info, fallback to current origin:', e);
      }

      // Generate E2EE Key
      state.cryptoKey = await E2EECrypto.generateKey();
      const hashKeyStr = await E2EECrypto.exportKeyToHash(state.cryptoKey);

      state.roomCode = data.roomCode;
      
      // Update URL with room code & key hash
      const shareUrl = `${hostOrigin}/#room=${state.roomCode}&key=${hashKeyStr}`;
      window.history.pushState(null, '', `/#room=${state.roomCode}&key=${hashKeyStr}`);

      initBridgeUI(shareUrl);
      joinSocketRoom(state.roomCode);
    } catch (err) {
      showToast('Error creating room: ' + err.message);
    } finally {
      btnCreateRoom.disabled = false;
    }
  }

  async function handleJoinRoom(roomCode) {
    try {
      hideJoinError();
      const hashParams = parseHashParams();
      
      if (!hashParams.key) {
        showJoinError('Missing E2EE encryption key in link fragment.');
        return;
      }

      state.cryptoKey = await E2EECrypto.importKeyFromHash(hashParams.key);
      state.roomCode = roomCode;

      const shareUrl = `${window.location.origin}/#room=${state.roomCode}&key=${hashParams.key}`;
      initBridgeUI(shareUrl);
      joinSocketRoom(state.roomCode);
    } catch (err) {
      showJoinError('Decryption key error: ' + err.message);
    }
  }

  function joinSocketRoom(roomCode) {
    state.socket.emit('join_room', { roomCode }, async (response) => {
      if (!response.success) {
        showJoinError(response.error);
        return;
      }

      showToast(`Connected to Bridge ${roomCode}!`);

      // Decrypt existing historical items in room if any
      if (response.items && response.items.length > 0) {
        for (const item of response.items) {
          await decryptAndAddItem(item);
        }
      }
    });
  }

  function initBridgeUI(shareUrl) {
    landingView.classList.add('hidden');
    bridgeView.classList.remove('hidden');

    displayRoomCode.textContent = state.roomCode;
    inputShareUrl.value = shareUrl;

    // Render QR Code
    if (!qrCodeObj) {
      qrCodeObj = new QRCode(qrContainer, {
        text: shareUrl,
        width: 180,
        height: 180,
        colorDark: "#0B0F19",
        colorLight: "#FFFFFF"
      });
    } else {
      qrCodeObj.makeCode(shareUrl);
    }
  }

  // ----------------------------------------------------
  // ENCRYPTION & ITEM PROCESSING
  // ----------------------------------------------------

  async function dropTextPayload(text) {
    const isUrl = /^https?:\/\/[^\s]+$/i.test(text);
    const itemType = isUrl ? 'link' : (text.includes('\n') || text.includes(';') ? 'text' : 'text');
    const buffer = E2EECrypto.stringToBuffer(text);

    await encryptAndEmitDrop(buffer, itemType, 'text/plain');
  }

  async function processAndDropFile(file) {
    // 25MB Hard Cap Client Validation
    if (file.size > 25 * 1024 * 1024) {
      showToast('File size exceeds 25MB ceiling.');
      return;
    }

    const isImage = file.type.startsWith('image/');
    const itemType = isImage ? 'image' : 'file';
    const buffer = await file.arrayBuffer();

    await encryptAndEmitDrop(buffer, itemType, file.type || 'application/octet-stream', file.name, file.size);
  }

  async function encryptAndEmitDrop(buffer, itemType, mimeType, fileName = '', fileSize = 0) {
    try {
      if (!state.cryptoKey || !state.roomCode) {
        showToast('Bridge key not initialized.');
        return;
      }

      // Format payload wrapper
      const rawPayloadObj = {
        itemType,
        mimeType,
        fileName,
        content: E2EECrypto.arrayBufferToBase64(buffer)
      };

      const jsonBuffer = E2EECrypto.stringToBuffer(JSON.stringify(rawPayloadObj));
      const encrypted = await E2EECrypto.encryptData(state.cryptoKey, jsonBuffer);

      state.socket.emit(
        'drop_item',
        {
          roomCode: state.roomCode,
          encryptedPayload: {
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            itemType,
            mimeType,
            size: fileSize || buffer.byteLength
          }
        },
        (res) => {
          if (!res.success) {
            showToast('Drop failed: ' + res.error);
          } else {
            showToast('Item encrypted & dropped!');
          }
        }
      );
    } catch (err) {
      showToast('Encryption failure: ' + err.message);
    }
  }

  async function decryptAndAddItem(item) {
    try {
      // Prevent duplicate item cards
      if (state.items.some(i => i.id === item.id)) return;

      const decryptedBuffer = await E2EECrypto.decryptData(state.cryptoKey, item.ciphertext, item.iv);
      const jsonString = E2EECrypto.bufferToString(decryptedBuffer);
      const rawPayload = JSON.parse(jsonString);

      const decryptedItem = {
        id: item.id,
        timestamp: item.timestamp,
        itemType: rawPayload.itemType || item.itemType,
        mimeType: rawPayload.mimeType || item.mimeType,
        fileName: rawPayload.fileName || 'file',
        contentBase64: rawPayload.content
      };

      state.items.unshift(decryptedItem);
      renderFeed();
    } catch (err) {
      console.error('Decryption failed for item:', err);
    }
  }

  // ----------------------------------------------------
  // UI RENDERERS & HELPERS
  // ----------------------------------------------------

  function renderFeed() {
    feedList.innerHTML = '';
    
    const filteredItems = state.items.filter(item => {
      if (state.filter === 'all') return true;
      return item.itemType === state.filter;
    });

    if (filteredItems.length === 0) {
      feedList.appendChild(emptyFeed);
      emptyFeed.classList.remove('hidden');
      return;
    }

    emptyFeed.classList.add('hidden');

    filteredItems.forEach(item => {
      const card = createItemCard(item);
      feedList.appendChild(card);
    });
  }

  function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';

    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let bodyHtml = '';
    const rawBuffer = E2EECrypto.base64ToArrayBuffer(item.contentBase64);

    if (item.itemType === 'link') {
      const urlText = E2EECrypto.bufferToString(rawBuffer);
      bodyHtml = `<a href="${escapeHtml(urlText)}" target="_blank" rel="noopener" class="link-card">🔗 ${escapeHtml(urlText)}</a>`;
    } else if (item.itemType === 'image') {
      const blob = new Blob([rawBuffer], { type: item.mimeType });
      const imgUrl = URL.createObjectURL(blob);
      bodyHtml = `<img src="${imgUrl}" class="img-preview" alt="Dropped Image">`;
    } else if (item.itemType === 'file') {
      const blob = new Blob([rawBuffer], { type: item.mimeType });
      const downloadUrl = URL.createObjectURL(blob);
      bodyHtml = `
        <div class="file-card">
          <span>📦 <strong>${escapeHtml(item.fileName)}</strong> (${formatBytes(rawBuffer.byteLength)})</span>
          <a href="${downloadUrl}" download="${escapeHtml(item.fileName)}" class="btn btn-secondary btn-sm">Download</a>
        </div>
      `;
    } else {
      const textContent = E2EECrypto.bufferToString(rawBuffer);
      if (textContent.includes('\n') || textContent.includes('{') || textContent.includes(';')) {
        bodyHtml = `<div class="code-block">${escapeHtml(textContent)}</div>`;
      } else {
        bodyHtml = `<div class="item-body">${escapeHtml(textContent)}</div>`;
      }
    }

    card.innerHTML = `
      <div class="item-header">
        <div class="item-meta">
          <span class="item-type-tag tag-${item.itemType}">${item.itemType}</span>
          <span>${timeStr}</span>
        </div>
        <div class="item-actions">
          ${item.itemType === 'text' || item.itemType === 'link' ? `<button class="btn-icon btn-copy-item" title="Copy Content">📋</button>` : ''}
        </div>
      </div>
      <div class="item-content-wrapper">
        ${bodyHtml}
      </div>
    `;

    // Copy Content Button Listener
    const btnCopyItem = card.querySelector('.btn-copy-item');
    if (btnCopyItem) {
      btnCopyItem.addEventListener('click', () => {
        const textToCopy = E2EECrypto.bufferToString(rawBuffer);
        copyToClipboard(textToCopy);
        showToast('Copied to clipboard!');
      });
    }

    return card;
  }

  function checkUrlParamsAndInit() {
    const hashParams = parseHashParams();
    const queryParams = new URLSearchParams(window.location.search);
    const roomFromUrl = hashParams.room || queryParams.get('room');

    if (roomFromUrl && hashParams.key) {
      inputRoomCode.value = roomFromUrl.toUpperCase();
      handleJoinRoom(roomFromUrl.toUpperCase());
    }
  }

  function parseHashParams() {
    const hash = window.location.hash.substring(1);
    const result = {};
    if (!hash) return result;
    hash.split('&').forEach(part => {
      const item = part.split('=');
      result[item[0]] = decodeURIComponent(item[1] || '');
    });
    return result;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  function showJoinError(msg) {
    joinError.textContent = msg;
    joinError.classList.remove('hidden');
  }

  function hideJoinError() {
    joinError.classList.add('hidden');
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
});
