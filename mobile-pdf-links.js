(() => {
  if (location.protocol !== "https:" && location.protocol !== "http:") return;

  const handheld = matchMedia("(max-width: 960px), (pointer: coarse)");
  let targets;

  function updateLinks() {
    if (!targets && !handheld.matches) return;
    if (!targets) {
      targets = [...document.querySelectorAll("a.pdf-page-link")].map(link => {
        const original = link.getAttribute("href");
        const [file, page] = original.split("#page=");
        const book = file === "pdf/application.pdf" ? "app" : "drv";
        const params = new URLSearchParams({ book, page });
        if (link.dataset.readerTop) params.set("top", link.dataset.readerTop);
        const day = link.closest(".day-row")?.id;
        if (day) params.set("day", day);
        return { link, original, reader: "reader.html?" + params };
      });
    }
    for (const { link, original, reader } of targets) {
      link.setAttribute("href", handheld.matches ? reader : original);
      link.target = handheld.matches ? "_self" : "_blank";
    }
  }

  updateLinks();
  if (handheld.addEventListener) handheld.addEventListener("change", updateLinks);
  else handheld.addListener(updateLinks);
})();
