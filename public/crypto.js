/**
 * DropBridge Native Web Crypto Engine (E2EE)
 * AES-GCM 256-bit browser-native zero-knowledge encryption
 */
const E2EECrypto = (function () {
  const ALGORITHM = 'AES-GCM';
  const KEY_LENGTH = 256;

  // Convert ArrayBuffer <-> Base64
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Generate new AES-GCM key
  async function generateKey() {
    return await window.crypto.subtle.generateKey(
      { name: ALGORITHM, length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Export CryptoKey to Base64Url for URL hash fragment (#key=...)
  async function exportKeyToHash(key) {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    const b64 = arrayBufferToBase64(exported);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Import CryptoKey from Base64Url string in URL hash
  async function importKeyFromHash(hashKeyStr) {
    let base64 = hashKeyStr.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const rawKey = base64ToArrayBuffer(base64);
    return await window.crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: ALGORITHM, length: KEY_LENGTH },
      true,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt ArrayBuffer or UTF-8 String
  async function encryptData(key, dataBuffer) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await window.crypto.subtle.encrypt(
      { name: ALGORITHM, iv: iv },
      key,
      dataBuffer
    );

    return {
      ciphertext: arrayBufferToBase64(encryptedBuffer),
      iv: arrayBufferToBase64(iv)
    };
  }

  // Decrypt Ciphertext back to ArrayBuffer
  async function decryptData(key, ciphertextBase64, ivBase64) {
    const ciphertext = base64ToArrayBuffer(ciphertextBase64);
    const iv = base64ToArrayBuffer(ivBase64);

    return await window.crypto.subtle.decrypt(
      { name: ALGORITHM, iv: new Uint8Array(iv) },
      key,
      ciphertext
    );
  }

  // Utility: Helper to convert String to ArrayBuffer
  function stringToBuffer(str) {
    return new TextEncoder().encode(str).buffer;
  }

  // Utility: Helper to convert ArrayBuffer to String
  function bufferToString(buffer) {
    return new TextDecoder().decode(buffer);
  }

  return {
    generateKey,
    exportKeyToHash,
    importKeyFromHash,
    encryptData,
    decryptData,
    stringToBuffer,
    bufferToString,
    arrayBufferToBase64,
    base64ToArrayBuffer
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = E2EECrypto;
}
