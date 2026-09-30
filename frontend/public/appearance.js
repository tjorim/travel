/* Blocking entry-point script: apply device appearance before the first paint. */
(() => {
  const key = "travel-appearance";
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const read = () => {
    try {
      const value = localStorage.getItem(key);
      return value === "light" || value === "dark" ? value : "auto";
    } catch {
      return "auto";
    }
  };
  let preference = read();
  const apply = () => {
    const theme = preference === "auto" ? (media.matches ? "dark" : "light") : preference;
    document.documentElement.dataset.appearance = preference;
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101c18" : "#f5f0e8");
    window.dispatchEvent(new Event("travel-appearance-change"));
  };
  window.addEventListener("travel-appearance-set", (event) => {
    const value = event.detail;
    if (!["auto", "light", "dark"].includes(value)) return;
    preference = value;
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Appearance still works without storage. */
    }
    apply();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) {
      preference = read();
      apply();
    }
  });
  media.addEventListener("change", apply);
  apply();
})();
