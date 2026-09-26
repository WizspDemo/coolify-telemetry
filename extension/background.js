// Minimal background service worker (required by MV3 manifest even if empty).
// Reserved for future use (e.g. periodic badge updates via chrome.alarms).
chrome.runtime.onInstalled.addListener(() => {
  console.log('Coolify Telemetry extension installed.');
});
