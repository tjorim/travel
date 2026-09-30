/* Blocking preference initialization shared by all four entry points. */
(() => {
  let stored;
  try {
    stored = localStorage.getItem("travel-locale");
  } catch {
    /* Device storage is optional. */
  }
  const supported = (value) => value === "nl" || value === "en";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  const locale = supported(stored)
    ? stored
    : (languages.map((tag) => tag.toLowerCase().split("-")[0]).find(supported) ?? "nl");
  document.documentElement.lang = locale;
  document.documentElement.dataset.travelLocale = locale;
})();
