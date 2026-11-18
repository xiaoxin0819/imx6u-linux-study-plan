"""Generate the static previews used by the mobile reader.

Run with Python and the pypdfium2 and Pillow packages installed.
"""

import argparse
from concurrent.futures import ProcessPoolExecutor
from contextlib import closing
from pathlib import Path
import os

import pypdfium2 as pdfium


ROOT = Path(__file__).resolve().parents[1]
BOOKS = {"app": ("application.pdf", 1115), "drv": ("drivers.pdf", 1963)}
WIDTH = 1100
CHUNK_SIZE = 48


def render_pages(job):
    book, first, last = job
    destination = ROOT / "pdf" / "pages-v1" / book
    with pdfium.PdfDocument(ROOT / "pdf" / BOOKS[book][0]) as document:
        for index in range(first, last):
            with closing(document[index]) as page:
                bitmap = page.render(scale=WIDTH / page.get_width(), draw_annots=True)
                try:
                    bitmap.to_pil().save(
                        destination / f"{index + 1}.webp",
                        format="WEBP",
                        quality=82,
                        method=3,
                    )
                finally:
                    bitmap.close()
    return last - first


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book", choices=BOOKS, help="Only regenerate one textbook")
    selected = parser.parse_args().book
    jobs = []
    for book, (filename, expected_pages) in BOOKS.items():
        if selected and book != selected:
            continue
        with pdfium.PdfDocument(ROOT / "pdf" / filename) as document:
            if len(document) != expected_pages:
                raise ValueError(f"{filename}: expected {expected_pages} pages, got {len(document)}")
        (ROOT / "pdf" / "pages-v1" / book).mkdir(parents=True, exist_ok=True)
        for first in range(0, expected_pages, CHUNK_SIZE):
            jobs.append((book, first, min(first + CHUNK_SIZE, expected_pages)))

    rendered = 0
    with ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as pool:
        for count in pool.map(render_pages, jobs):
            rendered += count
            if rendered % 240 < CHUNK_SIZE:
                print(f"Rendered {rendered} pages", flush=True)
    print(f"Ready: {rendered} pages", flush=True)


if __name__ == "__main__":
    main()
