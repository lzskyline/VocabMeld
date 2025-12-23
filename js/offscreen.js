/**
 * VocabMeld Offscreen Audio Player
 *
 * This script runs in an offscreen document to handle audio playback.
 * Manifest V3 Service Workers cannot use the Audio API directly,
 * so we use this offscreen document to play TTS audio from Edge TTS API.
 */

let currentAudio = null;

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'playAudio') {
    playAudio(message.audioData, message.mimeType)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }

  if (message.action === 'stopAudio') {
    stopAudio();
    sendResponse({ success: true });
    return false;
  }
});

/**
 * Play audio from base64 data
 * @param {string} base64Data - Base64 encoded audio data
 * @param {string} mimeType - MIME type of the audio (e.g., 'audio/mpeg')
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function playAudio(base64Data, mimeType) {
  try {
    // Stop any currently playing audio
    stopAudio();

    // Convert base64 to blob
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });

    // Create audio URL and play
    const audioUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(audioUrl);

    return new Promise((resolve) => {
      currentAudio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        resolve({ success: true });
      };

      currentAudio.onerror = (e) => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        resolve({ success: false, error: 'Audio playback failed: ' + (e.message || 'Unknown error') });
      };

      currentAudio.play().catch(error => {
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
        resolve({ success: false, error: 'Failed to play audio: ' + error.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Stop currently playing audio
 */
function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}

console.log('[VocabMeld] Offscreen audio player loaded');
