const books = {
  app: { name: "C 应用编程指南", file: "application.pdf" },
  drv: { name: "Linux 驱动开发指南", file: "drivers.pdf" },
};

const params = new URLSearchParams(location.search);
const book = Object.hasOwn(books, params.get("book")) ? books[params.get("book")] : null;
const scroll = document.querySelector("#reader-scroll");
const status = document.querySelector("#status");
const original = document.querySelector("#original");
const input = document.querySelector("#page-number");
const total = document.querySelector("#page-total");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const zoomOut = document.querySelector("#zoom-out");
const zoomIn = document.querySelector("#zoom-in");
const vendor = new URL("./vendor/pdfjs/", import.meta.url);

let pdf;
let pageNumber = Math.max(1, Number.parseInt(params.get("page"), 10) || 1);
let bookmarkTop = params.get("top") !== null ? Number(params.get("top")) : null;
if (!Number.isFinite(bookmarkTop)) bookmarkTop = null;
let zoom = 1;
let renderTask;
let revision = 0;
let renderedPage;

const day = params.get("day");
if (/^day-\d{2}$/.test(day ?? "")) document.querySelector("#back").href = "./#" + day;

function showStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

function updateControls() {
  input.disabled = !pdf;
  input.value = pdf ? String(pageNumber) : "";
  total.textContent = pdf ? "/ " + pdf.numPages : "";
  previous.disabled = !pdf || pageNumber <= 1;
  next.disabled = !pdf || pageNumber >= pdf.numPages;
  zoomOut.disabled = !pdf || zoom <= 1;
  zoomIn.disabled = !pdf || zoom >= 3;
  original.href = "pdf/" + book.file + "#page=" + pageNumber;
}

async function showPage() {
  const request = ++revision;
  renderTask?.cancel();
  scroll.setAttribute("aria-busy", "true");
  const number = pageNumber;
  const previousView = renderedPage === number && bookmarkTop === null ? {
    y: scroll.scrollTop / Math.max(1, scroll.querySelector("canvas")?.clientHeight || 1),
    x: scroll.scrollLeft / Math.max(1, scroll.querySelector("canvas")?.clientWidth || 1),
  } : null;
  if (renderedPage !== number) {
    scroll.replaceChildren();
    showStatus("正在打开第 " + number + " 页…");
  }

  try {
    const page = await pdf.getPage(number);
    if (request !== revision) return;
    const base = page.getViewport({ scale: 1 });
    const available = Math.min(1000, scroll.clientWidth - 12);
    const viewport = page.getViewport({ scale: Math.max(1, available) / base.width * zoom });
    const pixelRatio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(8000000 / (viewport.width * viewport.height)));
    const sheet = document.createElement("div");
    sheet.className = "pdf-sheet";
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", book.name + "第 " + number + " 页");
    canvas.width = Math.max(1, Math.ceil(viewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.ceil(viewport.height * pixelRatio));
    canvas.style.width = viewport.width + "px";
    canvas.style.height = viewport.height + "px";
    sheet.append(canvas);

    renderTask = page.render({ canvas, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] });
    await renderTask.promise;
    if (request !== revision) return;

    let y = 0;
    if (bookmarkTop !== null) {
      const [, point] = viewport.convertToViewportPoint(0, bookmarkTop);
      y = Math.max(0, Math.min(viewport.height - 18, point));
      const marker = document.createElement("span");
      marker.className = "bookmark-marker";
      marker.style.top = y + "px";
      marker.setAttribute("aria-hidden", "true");
      sheet.append(marker);
    }

    scroll.replaceChildren(sheet);
    renderedPage = number;
    showStatus("");
    scroll.scrollTo(previousView?.x * viewport.width || 0,
      previousView ? previousView.y * viewport.height : Math.max(0, y - 12));
  } catch {
    if (request === revision) showStatus("这一页暂时无法显示。请重试或打开原 PDF。");
  } finally {
    if (request === revision) {
      renderTask = null;
      scroll.setAttribute("aria-busy", "false");
    }
  }
}

function goTo(number) {
  if (!pdf || !Number.isSafeInteger(number)) return;
  pageNumber = Math.min(pdf.numPages, Math.max(1, number));
  bookmarkTop = null;
  params.set("page", String(pageNumber));
  params.delete("top");
  history.replaceState(null, "", "?" + params.toString());
  updateControls();
  void showPage();
}

function changeZoom(delta) {
  if (!pdf) return;
  zoom = Math.min(3, Math.max(1, zoom + delta));
  updateControls();
  void showPage();
}

if (!book) {
  showStatus("找不到这本教材。请返回计划，从章节标题重新打开。");
  scroll.setAttribute("aria-busy", "false");
} else {
  document.title = book.name + " · I.MX6U Linux";
  document.querySelector("#book-title").textContent = book.name;
  original.hidden = false;
  updateControls();
  try {
    const pdfjs = await import(new URL("pdf.min.mjs", vendor));
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdf.worker.min.mjs", vendor).href;
    const url = new URL("pdf/" + book.file, location.href).href;
    pdf = await pdfjs.getDocument({
      url,
      cMapUrl: new URL("cmaps/", vendor).href,
      cMapPacked: true,
      iccUrl: new URL("iccs/", vendor).href,
      standardFontDataUrl: new URL("standard_fonts/", vendor).href,
      wasmUrl: new URL("wasm/", vendor).href,
      disableStream: true,
      disableAutoFetch: true,
      rangeChunkSize: 262144,
      isEvalSupported: false,
    }).promise;
    pageNumber = Math.min(pageNumber, pdf.numPages);
    updateControls();
    void showPage();
  } catch {
    showStatus("教材暂时无法打开。请重试或打开原 PDF。");
    scroll.setAttribute("aria-busy", "false");
  }
}

document.querySelector("#controls").addEventListener("submit", event => {
  event.preventDefault();
  goTo(Number(input.value.trim()));
  input.blur();
});
previous.addEventListener("click", () => goTo(pageNumber - 1));
next.addEventListener("click", () => goTo(pageNumber + 1));
zoomOut.addEventListener("click", () => changeZoom(-0.4));
zoomIn.addEventListener("click", () => changeZoom(0.4));
let resizeDelay;
window.addEventListener("resize", () => {
  clearTimeout(resizeDelay);
  resizeDelay = setTimeout(() => { if (pdf) void showPage(); }, 180);
});
