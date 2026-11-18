const books = {
  app: { name: "C 应用编程指南", file: "application.pdf?v=d8b408a3", pages: 1115 },
  drv: { name: "Linux 驱动开发指南", file: "drivers.pdf", pages: 1963 },
};
// The two editions use this unrotated PDF crop box on every page.
const PAGE_WIDTH = 595.32;
const PAGE_HEIGHT = 841.92;
const GAP = 12;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 3;
const PREVIEW_WIDTH = 680;

const byId = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const key = params.get("book");
const book = Object.hasOwn(books, key) ? books[key] : null;
const scroll = byId("reader-scroll");
const rail = byId("pdf-rail");
const status = byId("status");
const message = byId("status-message");
const retry = byId("retry");
const original = byId("original");
const pageInput = byId("page-number");
const zoomInput = byId("zoom-percent");
const previous = byId("previous");
const next = byId("next");
const zoomOut = byId("zoom-out");
const zoomIn = byId("zoom-in");
const zoomReset = byId("zoom-reset");

const clampPage = number => Math.min(book.pages, Math.max(1, number));
const initialPage = book ? clampPage(Number.parseInt(params.get("page"), 10) || 1) : 1;
const rawTop = params.has("top") ? Number(params.get("top")) : NaN;
const bookmark = Number.isFinite(rawTop) ? { page: initialPage, top: rawTop } : null;
const mounted = new Map();
let currentPage = initialPage;
let zoom = 1;
let width = 0;
let height = 0;
let stride = 0;
let insetTop = 0;
let observedWidth = 0;
let initialized = false;
let updateFrame = 0;
let urlTimer;
let loadTimer;
let firstPageImage = byId("first-page-image");

const day = params.get("day");
if (/^day-\d{2}$/.test(day ?? "")) byId("back").href = "./#" + day;

function showStatus(text, canRetry = false) {
  message.textContent = text;
  retry.hidden = !canRetry;
  status.hidden = !text;
}

function setActivePage(number) {
  currentPage = number;
  if (document.activeElement !== pageInput) pageInput.value = String(number);
  previous.disabled = number <= 1;
  next.disabled = number >= book.pages;
  original.href = "pdf/" + book.file + "#page=" + number;
  clearTimeout(urlTimer);
  urlTimer = setTimeout(() => {
    if (params.get("page") === String(currentPage)) return;
    params.set("page", String(currentPage));
    if (bookmark && currentPage === bookmark.page) params.set("top", String(bookmark.top));
    else params.delete("top");
    history.replaceState(null, "", "?" + params.toString());
  }, 240);
}

function showZoom() {
  if (document.activeElement !== zoomInput) zoomInput.value = String(Math.round(zoom * 100));
  zoomOut.disabled = zoom <= MIN_ZOOM;
  zoomIn.disabled = zoom >= MAX_ZOOM;
  zoomReset.disabled = zoom === 1;
}

function bookmarkOffset() {
  return Math.max(0, Math.min(height - 18, (1 - bookmark.top / PAGE_HEIGHT) * height));
}

function place(tile) {
  tile.element.style.top = (tile.number - 1) * stride + "px";
  tile.element.style.height = height + "px";
  if (tile.marker) tile.marker.style.top = bookmarkOffset() + "px";
}

function measure() {
  const style = getComputedStyle(scroll);
  observedWidth = scroll.clientWidth;
  const gutter = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  insetTop = parseFloat(style.paddingTop);
  width = Math.max(1, Math.min(880, observedWidth - gutter)) * zoom;
  height = width / PAGE_WIDTH * PAGE_HEIGHT;
  stride = height + GAP;
  rail.style.width = width + "px";
  rail.style.height = (stride * book.pages - GAP) + "px";
  for (const tile of mounted.values()) place(tile);
}

function pageAt(y) {
  return clampPage(Math.floor(Math.max(0, y - insetTop) / stride) + 1);
}

function showWindow() {
  const from = pageAt(scroll.scrollTop - stride * 0.65);
  const to = pageAt(scroll.scrollTop + scroll.clientHeight + stride * 0.65);
  for (let number = from; number <= to; number++) {
    if (!mounted.has(number)) mount(number, number === currentPage ? "high" : "low");
  }
  for (const [number, tile] of mounted) {
    if (number >= from && number <= to) continue;
    if (!tile.image.complete) tile.image.removeAttribute("src");
    tile.element.remove();
    mounted.delete(number);
  }
  upgrade(mounted.get(currentPage));
}

function scheduleWindow() {
  if (updateFrame) return;
  updateFrame = requestAnimationFrame(() => {
    updateFrame = 0;
    const bottom = scroll.scrollHeight - scroll.clientHeight;
    const number = bottom > 0 && scroll.scrollTop >= bottom - 2
      ? book.pages : pageAt(scroll.scrollTop + 13);
    if (number !== currentPage) {
      setActivePage(number);
      showStatus("");
      if (!initialized) initialized = true;
    }
    if (initialized) showWindow();
  });
}

function imageUrl(tile, full) {
  return (full ? "pdf/pages-v1/" : "pdf/thumbs-v1/") + key + "/" + tile.number + ".webp";
}

function needsFullImage() {
  return width * (devicePixelRatio || 1) > PREVIEW_WIDTH || zoom > 1.2;
}

function upgrade(tile) {
  if (!tile?.loaded || tile.full || tile.upgrading || !needsFullImage()) return;
  tile.upgrading = true;
  const nextImage = new Image();
  nextImage.fetchPriority = "low";
  nextImage.alt = tile.image.alt;
  nextImage.decoding = "async";
  nextImage.onload = async () => {
    try { await nextImage.decode(); } catch { return; }
    if (mounted.get(tile.number) !== tile) return;
    tile.image.replaceWith(nextImage);
    tile.image = nextImage;
    tile.full = true;
  };
  nextImage.src = imageUrl(tile, true);
}

function load(tile, force = false) {
  const { image, placeholder, label, button } = tile;
  tile.loaded = false;
  tile.full = firstPageImage && tile.number === initialPage
    ? firstPageImage.dataset.full === "true"
    : needsFullImage();
  if (tile.number === initialPage) firstPageImage = null;
  tile.upgrading = false;
  let usedFallback = false;
  const cacheBust = force ? "?retry=" + Date.now() : "";
  image.hidden = true;
  placeholder.hidden = false;
  label.textContent = "正在打开第 " + tile.number + " 页…";
  button.hidden = true;

  image.onload = () => {
    if (mounted.get(tile.number) !== tile) return;
    tile.loaded = true;
    image.hidden = false;
    placeholder.hidden = true;
    if (tile.number === currentPage) {
      clearTimeout(loadTimer);
      showStatus("");
      initialized = true;
      scheduleWindow();
    }
  };
  image.onerror = () => {
    if (mounted.get(tile.number) !== tile) return;
    if (!usedFallback) {
      usedFallback = true;
      // Keep the other rendition available if a request fails.
      tile.upgrading = tile.full;
      tile.full = !tile.full;
      image.src = imageUrl(tile, tile.full) + cacheBust;
      return;
    }
    label.textContent = "这一页加载失败";
    button.hidden = false;
    if (tile.number === currentPage) {
      clearTimeout(loadTimer);
      showStatus("这一页加载失败，可以重试或打开原 PDF。", true);
      initialized = true;
      scheduleWindow();
    }
  };
  image.src = imageUrl(tile, tile.full) + cacheBust;
}

function mount(number, priority) {
  const element = document.createElement("div");
  element.className = "pdf-sheet";
  element.dataset.page = String(number);
  const image = new Image();
  image.alt = book.name + "第 " + number + " 页";
  image.fetchPriority = priority;
  image.decoding = "async";
  const placeholder = document.createElement("div");
  placeholder.className = "page-placeholder";
  const label = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "重试";
  placeholder.append(label, button);
  element.append(image, placeholder);
  const tile = { number, element, image, placeholder, label, button, marker: null };
  if (bookmark?.page === number) {
    tile.marker = document.createElement("span");
    tile.marker.className = "bookmark-marker";
    tile.marker.setAttribute("aria-hidden", "true");
    element.append(tile.marker);
  }
  mounted.set(number, tile);
  place(tile);
  rail.append(element);
  button.addEventListener("click", () => load(tile, true));
  load(tile);
}

function jumpTo(number, useBookmark = false) {
  if (!book || !Number.isSafeInteger(number)) return;
  const target = clampPage(number);
  setActivePage(target);
  pageInput.value = String(target);
  if (!mounted.has(target)) mount(target, "high");
  showStatus("");
  const offset = useBookmark && bookmark ? bookmarkOffset() - 12 : 0;
  scroll.scrollTo(0, insetTop + (target - 1) * stride + Math.max(0, offset));
  if (initialized) showWindow();
}

function reshape(factor, pointX = scroll.clientWidth / 2, pointY = scroll.clientHeight / 3) {
  if (!book || !Number.isFinite(factor)) return;
  const xOnScreen = scroll.getBoundingClientRect().left + pointX;
  const x = (xOnScreen - rail.getBoundingClientRect().left) / width;
  const y = (scroll.scrollTop + pointY - insetTop) / stride;
  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
  measure();
  scroll.scrollTop = insetTop + y * stride - pointY;
  scroll.scrollLeft += rail.getBoundingClientRect().left + x * width - xOnScreen;
  showZoom();
  if (initialized) scheduleWindow();
}

function retryCurrent() {
  const tile = mounted.get(currentPage);
  if (tile) {
    showStatus("");
    load(tile, true);
  }
}

if (book) {
  document.title = book.name + " · I.MX6U Linux";
  byId("book-title").textContent = book.name;
  byId("page-total").textContent = "/ " + book.pages;
  original.hidden = false;
  pageInput.disabled = false;
  zoomInput.disabled = false;
  measure();
  showZoom();
  jumpTo(initialPage, true);
  loadTimer = setTimeout(() => {
    if (currentPage === initialPage && !mounted.get(initialPage)?.loaded) {
      showStatus("连接较慢，可以重试或打开原 PDF。", true);
    }
  }, 7500);
  scroll.addEventListener("scroll", scheduleWindow, { passive: true });
} else {
  showStatus("找不到这本教材。请返回计划，从章节标题重新打开。");
}

byId("page-controls").addEventListener("submit", event => {
  event.preventDefault();
  if (pageInput.value.trim()) jumpTo(Number(pageInput.value.trim()));
  pageInput.blur();
});
byId("zoom-controls").addEventListener("submit", event => {
  event.preventDefault();
  if (zoomInput.value.trim()) reshape(Number(zoomInput.value.trim()) / 100);
  zoomInput.blur();
  showZoom();
});
zoomInput.addEventListener("change", () => {
  if (zoomInput.value.trim()) reshape(Number(zoomInput.value.trim()) / 100);
  zoomInput.value = String(Math.round(zoom * 100));
});
previous.addEventListener("click", () => jumpTo(currentPage - 1));
next.addEventListener("click", () => jumpTo(currentPage + 1));
zoomOut.addEventListener("click", () => reshape(zoom - 0.25));
zoomIn.addEventListener("click", () => reshape(zoom + 0.25));
zoomReset.addEventListener("click", () => reshape(1));
retry.addEventListener("click", retryCurrent);

let pinch;
function gesture(touches) {
  const [a, b] = touches;
  const bounds = scroll.getBoundingClientRect();
  return {
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    x: (a.clientX + b.clientX) / 2 - bounds.left,
    y: (a.clientY + b.clientY) / 2 - bounds.top,
  };
}
scroll.addEventListener("touchstart", event => {
  if (book && event.touches.length === 2) {
    event.preventDefault();
    pinch = { distance: gesture(event.touches).distance, zoom };
  }
}, { passive: false });
scroll.addEventListener("touchmove", event => {
  if (!pinch || event.touches.length !== 2) return;
  event.preventDefault();
  const { distance, x, y } = gesture(event.touches);
  if (pinch.distance > 0) reshape(pinch.zoom * distance / pinch.distance, x, y);
}, { passive: false });
for (const type of ["touchend", "touchcancel"]) {
  scroll.addEventListener(type, () => { pinch = null; });
}

let resizeDelay;
window.addEventListener("resize", () => {
  clearTimeout(resizeDelay);
  resizeDelay = setTimeout(() => {
    if (book && observedWidth !== scroll.clientWidth) reshape(zoom);
    else if (book && initialized) scheduleWindow();
  }, 100);
});
