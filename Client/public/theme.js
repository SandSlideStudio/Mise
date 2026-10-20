/* global localStorage, document */
// Set day or night before anything paints, so the pass never flashes white.
// A file rather than an inline script, so the content security policy can
// refuse every inline script outright.
try {
  var theme = localStorage.getItem('mise.theme');
  if (theme === 'day' || theme === 'night') {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch {
  // Storage can be blocked; the page then follows the device's own setting.
}
