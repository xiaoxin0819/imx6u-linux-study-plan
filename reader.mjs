const books = {
  app: { name: "C 应用编程指南", file: "application.pdf?v=d8b408a3", pages: 1115 },
  drv: { name: "Linux 驱动开发指南", file: "drivers.pdf", pages: 1963 },
};
// Both editions use unrotated pages with this PDF crop box height.
const PDF_PAGE_HEIGHT = 841.92;

const params = new URLSearchParams(location.search);
const key = params.get("book");
const book = Object.hasOwn(books, key) ? books[key] : null;
const scroll = document.querySelector("#reader-scroll");
const status = document.querySelector("#status");
const message = document.querySelector("#status-message");
const retry = document.querySelector("#retry");
const original = document.querySelector("#original");
const input = document.querySelector("#page-number");
const total = document.querySelector("#page-total");
const previous = document.querySelector("#previous");
const next = document.querySelector("#next");
const zoomOut = document.querySelector("#zoom-out");
const zoomIn = document.querySelector("#zoom-in");
const zoomReset = document.querySelector("#zoom-reset");

const initialPage = Number.parseInt(params.get("page"), 10) || 1;
let pageNumber = Math.min(book?.pages ?? 1, Math.max(1, initialPage));
let bookmarkTop = params.has("top") ? Number(params.get("top")) : null;
if (!Number.isFinite(bookmarkTop)) bookmarkTop = null;
let zoom = 1;
let sheet;
let marker;
let version = 0;
let loadTimer;

const day = params.get("day");
if (/^day-\d{2}$/.test(day ?? "")) document.querySelector("#back").href = "./#" + day;

function showStatus(text, canRetry = false) {
  message.textContent = text;
  retry.hidden = !canRetry;
  status.hidden = !text;
}

function updateControls() {
  input.disabled = false;
  input.value = String(pageNumber);
  total.textContent = "/ " + book.pages;
  previous.disabled = pageNumber <= 1;
  next.disabled = pageNumber >= book.pages;
  zoomOut.disabled = !sheet || zoom <= 1;
  zoomIn.disabled = !sheet || zoom >= 3;
  zoomReset.disabled = !sheet || zoom === 1;
  zoomReset.textContent = zoom === 1 ? "适宽" : Math.round(zoom * 100) + "%";
  original.href = "pdf/" + book.file + "#page=" + pageNumber;
}

function fitSheet(jumpToBookmark = false) {
  if (!sheet) return;
  const relativeX = scroll.scrollLeft / Math.max(1, sheet.offsetWidth);
  const relativeY = scroll.scrollTop / Math.max(1, sheet.offsetHeight);
  const style = getComputedStyle(scroll);
  const available = Math.max(1, Math.min(880, scroll.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)));
  sheet.style.width = available * zoom + "px";

  if (marker) {
    const target = (1 - bookmarkTop / PDF_PAGE_HEIGHT) * sheet.offsetHeight;
    marker.style.top = Math.max(0, Math.min(sheet.offsetHeight - 18, target)) + "px";
  }
  if (jumpToBookmark) {
    scroll.scrollTo(0, marker ? Math.max(0, marker.offsetTop - 12) : 0);
  } else {
    scroll.scrollTo(relativeX * sheet.offsetWidth, relativeY * sheet.offsetHeight);
  }
}

function openPage(force = false) {
  const attempt = ++version;
  clearTimeout(loadTimer);
  sheet = null;
  marker = null;
  scroll.replaceChildren();
  scroll.setAttribute("aria-busy", "true");
  showStatus("正在打开第 " + pageNumber + " 页…");
  updateControls();

  const image = new Image();
  image.alt = book.name + "第 " + pageNumber + " 页";
  image.fetchPriority = "high";
  image.decoding = "async";
  image.addEventListener("load", () => {
    if (attempt !== version) return;
    clearTimeout(loadTimer);
    sheet = document.createElement("div");
    sheet.className = "pdf-sheet";
    sheet.append(image);
    if (bookmarkTop !== null) {
      marker = document.createElement("span");
      marker.className = "bookmark-marker";
      marker.setAttribute("aria-hidden", "true");
      sheet.append(marker);
    }
    scroll.replaceChildren(sheet);
    showStatus("");
    scroll.setAttribute("aria-busy", "false");
    fitSheet(true);
    updateControls();
  }, { once: true });
  image.addEventListener("error", () => {
    if (attempt !== version) return;
    clearTimeout(loadTimer);
    scroll.setAttribute("aria-busy", "false");
    showStatus("这一页加载失败，可以重试或打开原 PDF。", true);
  }, { once: true });
  loadTimer = setTimeout(() => showStatus("连接较慢，可以重试或打开原 PDF。", true), 8000);
  image.src = "pdf/pages-v1/" + key + "/" + pageNumber + ".webp" + (force ? "?retry=" + Date.now() : "");
}

function goTo(number) {
  if (!book || !Number.isSafeInteger(number)) return;
  pageNumber = Math.min(book.pages, Math.max(1, number));
  bookmarkTop = null;
  params.set("page", String(pageNumber));
  params.delete("top");
  history.replaceState(null, "", "?" + params.toString());
  openPage();
}

function setZoom(factor) {
  if (!sheet) return;
  zoom = Math.min(3, Math.max(1, factor));
  fitSheet(Boolean(marker));
  updateControls();
}

if (book) {
  document.title = book.name + " · I.MX6U Linux";
  document.querySelector("#book-title").textContent = book.name;
  original.hidden = false;
  openPage();
} else {
  showStatus("找不到这本教材。请返回计划，从章节标题重新打开。");
  scroll.setAttribute("aria-busy", "false");
}

document.querySelector("#controls").addEventListener("submit", event => {
  event.preventDefault();
  if (input.value.trim()) goTo(Number(input.value.trim()));
  input.blur();
});
previous.addEventListener("click", () => goTo(pageNumber - 1));
next.addEventListener("click", () => goTo(pageNumber + 1));
zoomOut.addEventListener("click", () => setZoom(zoom - 0.4));
zoomIn.addEventListener("click", () => setZoom(zoom + 0.4));
zoomReset.addEventListener("click", () => setZoom(1));
retry.addEventListener("click", () => openPage(true));
let resizeDelay;
window.addEventListener("resize", () => {
  clearTimeout(resizeDelay);
  resizeDelay = setTimeout(() => fitSheet(), 120);
});
