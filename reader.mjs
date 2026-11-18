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
const DEFAULT_ZOOM = 1.25;
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
let zoom = DEFAULT_ZOOM;
let width = 0;
let height = 0;
let stride = 0;
let insetTop = 0;
let observedWidth = 0;
let updateFrame = 0;
let urlTimer;
let activeLoad;
let previousScrollTop = 0;
let direction = 1;

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
  const top = scroll.scrollTop;
  const bottom = top + scroll.clientHeight;
  const firstVisible = pageAt(top);
  const lastVisible = pageAt(bottom - 1);
  const ahead = clampPage(direction > 0 ? lastVisible + 1 : firstVisible - 1);
  const from = Math.min(ahead, pageAt(top - stride * 0.65));
  const to = Math.max(ahead, pageAt(bottom + stride * 0.65));
  for (let number = from; number <= to; number++) {
    if (!mounted.has(number)) mount(number);
  }
  for (const [number, tile] of mounted) {
    if (number >= from && number <= to) continue;
    tile.element.remove();
    mounted.delete(number);
  }
  loadWindow(firstVisible, lastVisible, ahead);
}

function scheduleWindow() {
  if (updateFrame) return;
  updateFrame = requestAnimationFrame(() => {
    updateFrame = 0;
    const top = scroll.scrollTop;
    if (top !== previousScrollTop) direction = Math.sign(top - previousScrollTop);
    previousScrollTop = top;
    const bottom = scroll.scrollHeight - scroll.clientHeight;
    const number = bottom > 0 && top >= bottom - 2 ? book.pages : pageAt(top + 13);
    if (number !== currentPage) {
      setActivePage(number);
      showStatus("");
    }
    showWindow();
  });
}

function imageUrl(tile, full) {
  return (full ? "pdf/pages-v1/" : "pdf/thumbs-v1/") + key + "/" + tile.number + ".webp";
}

function needsFullImage() {
  return width * (devicePixelRatio || 1) > PREVIEW_WIDTH || zoom > 1.2;
}

function cancelLoad() {
  if (!activeLoad) return;
  clearTimeout(activeLoad.timer);
  const { tile } = activeLoad;
  if (!tile.image) tile.label.textContent = "等待加载第 " + tile.number + " 页…";
  activeLoad.image.onload = null;
  activeLoad.image.onerror = null;
  activeLoad.image.removeAttribute("src");
  activeLoad = null;
}

function loadWindow(firstVisible, lastVisible, ahead) {
  const current = mounted.get(currentPage);
  if (activeLoad && (
    !mounted.has(activeLoad.tile.number) ||
    (current && !current.image && !current.failed && activeLoad.tile !== current)
  )) cancelLoad();
  if (current?.failed) showStatus("这一页加载失败，可以重试或打开原 PDF。", true);
  if (activeLoad) {
    if (activeLoad.tile === current && activeLoad.slow && !current.image) {
      showStatus("这一页加载较慢，可以重试或打开原 PDF。", true);
    }
    return;
  }

  if (current && !current.failed &&
      (!current.image || (!current.full && !current.fullFailed && needsFullImage()))) {
    load(current);
    return;
  }
  // Read in scroll order, with one page of lookahead beyond the viewport.
  const visible = [];
  for (let number = firstVisible; number <= lastVisible; number++) visible.push(number);
  if (direction < 0) visible.reverse();
  const pending = [...visible, ahead].map(number => mounted.get(number))
    .find(tile => tile && !tile.image && !tile.failed);
  if (pending) load(pending);
}

function load(tile, force = false) {
  const image = new Image();
  image.alt = book.name + "第 " + tile.number + " 页";
  image.fetchPriority = tile.number === currentPage ? "high" : "low";
  image.decoding = "async";
  let full = needsFullImage();
  let fallback = false;
  const cacheBust = force ? "?retry=" + Date.now() : "";
  tile.failed = false;
  tile.button.hidden = true;
  tile.label.textContent = "正在加载第 " + tile.number + " 页…";
  const job = { tile, image };
  job.timer = setTimeout(() => {
    job.slow = true;
    if (tile.number === currentPage && !tile.image) scheduleWindow();
  }, 7500);
  activeLoad = job;

  const finish = () => {
    clearTimeout(job.timer);
    activeLoad = null;
    scheduleWindow();
  };
  image.onload = () => {
    if (activeLoad !== job) return;
    if (tile.image) tile.image.replaceWith(image);
    else tile.element.prepend(image);
    tile.image = image;
    tile.full = full;
    tile.placeholder.hidden = true;
    if (tile.number === currentPage) showStatus("");
    finish();
  };
  image.onerror = () => {
    if (activeLoad !== job) return;
    if (full) tile.fullFailed = true;
    if (!tile.image && !fallback) {
      fallback = true;
      full = !full;
      image.src = imageUrl(tile, full) + cacheBust;
      return;
    }
    if (!tile.image) {
      tile.failed = true;
      tile.label.textContent = "第 " + tile.number + " 页加载失败";
      tile.button.hidden = false;
    }
    finish();
  };
  image.src = imageUrl(tile, full) + cacheBust;
}

function mount(number) {
  const element = document.createElement("div");
  element.className = "pdf-sheet";
  element.dataset.page = String(number);
  const placeholder = document.createElement("div");
  placeholder.className = "page-placeholder";
  const label = document.createElement("span");
  label.textContent = "等待加载第 " + number + " 页…";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "重试";
  button.hidden = true;
  placeholder.append(label, button);
  element.append(placeholder);
  const tile = { number, element, placeholder, label, button, marker: null };
  if (bookmark?.page === number) {
    tile.marker = document.createElement("span");
    tile.marker.className = "bookmark-marker";
    tile.marker.setAttribute("aria-hidden", "true");
    element.append(tile.marker);
  }
  mounted.set(number, tile);
  place(tile);
  rail.append(element);
  button.addEventListener("click", () => retryPage(tile));
}

function jumpTo(number, opening = false) {
  if (!book || !Number.isSafeInteger(number)) return;
  const target = clampPage(number);
  if (target !== currentPage) direction = Math.sign(target - currentPage);
  setActivePage(target);
  pageInput.value = String(target);
  showStatus("");
  const offset = opening && bookmark ? bookmarkOffset() - 12 : 0;
  const left = opening ? (scroll.scrollWidth - scroll.clientWidth) / 2 : scroll.scrollLeft;
  scroll.scrollTo(left, insetTop + (target - 1) * stride + Math.max(0, offset));
  previousScrollTop = scroll.scrollTop;
  showWindow();
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
  previousScrollTop = scroll.scrollTop;
  showZoom();
  scheduleWindow();
}

function retryPage(tile) {
  if (!tile) return;
  cancelLoad();
  showStatus("");
  tile.fullFailed = false;
  load(tile, true);
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
retry.addEventListener("click", () => retryPage(mounted.get(currentPage)));

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
    else if (book) scheduleWindow();
  }, 100);
});
