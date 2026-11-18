(() => {
  if (location.protocol !== "https:" && location.protocol !== "http:") return;

  const handheld = matchMedia("(max-width: 960px), (pointer: coarse)");
  const nativeHrefs = new WeakMap();

  function updateLink(event) {
    const link = event.target.closest?.("a.pdf-page-link");
    if (!link) return;

    const cached = nativeHrefs.get(link);
    if (!handheld.matches) {
      if (cached) {
        link.setAttribute("href", cached);
        link.target = "_blank";
        nativeHrefs.delete(link);
      }
      return;
    }
    if (cached) return;

    const original = link.getAttribute("href");
    const [file, page] = original.split("#page=");
    const book = file.split("?")[0] === "pdf/application.pdf" ? "app" : "drv";
    const params = new URLSearchParams({ book, page });
    if (link.dataset.readerTop) params.set("top", link.dataset.readerTop);
    const day = link.closest(".day-row")?.id;
    if (day) params.set("day", day);

    nativeHrefs.set(link, original);
    link.setAttribute("href", "reader.html?" + params + "&v=4");
    link.target = "_self";
  }

  for (const event of ["pointerdown", "focusin", "contextmenu", "click"]) {
    document.addEventListener(event, updateLink);
  }
})();
