// Runs before the page paints so the chosen colour scheme never flashes.
(function () {
  try {
    var pref = localStorage.getItem('threatorbit-theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {}
})();
