export interface PaginationComponent {
  update: (page: number, pageCount: number) => void;
}

// Binds to markup already in index.html and updates it in place. Rebuilding
// the buttons on every render would drop keyboard focus from the button the
// user just pressed.
export function createPagination(
  root: HTMLElement,
  onPageChange: (page: number) => void,
): PaginationComponent {
  const prev = root.querySelector<HTMLButtonElement>("[data-prev]")!;
  const next = root.querySelector<HTMLButtonElement>("[data-next]")!;
  const label = root.querySelector<HTMLElement>("[data-page-label]")!;

  // The page currently on screen. Listeners are attached once and read this at
  // click time, so a double click on Next requests the same page twice rather
  // than skipping one.
  let currentPage = 1;

  prev.addEventListener("click", () => onPageChange(currentPage - 1));
  next.addEventListener("click", () => onPageChange(currentPage + 1));

  function update(page: number, pageCount: number): void {
    currentPage = page;
    root.hidden = pageCount <= 1;
    label.textContent = `Page ${page} of ${pageCount}`;
    prev.disabled = page <= 1;
    next.disabled = page >= pageCount;
  }

  return { update };
}
