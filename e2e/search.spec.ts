import { expect, test, type Page } from "@playwright/test";
import type { SearchResponse } from "../shared/api-types.ts";

// Prefer web-first assertions (`await expect(locator).toHaveText(...)`): they
// retry until the UI catches up. One-off reads like allTextContents() can run
// before the view transition has swapped the new cards in.

test("free-text search returns results and syncs the URL", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("items found");

  await page.getByRole("searchbox", { name: "Search items" }).fill("trail");
  await expect(page).toHaveURL(/[?&]q=trail/);
  await expect(page.getByRole("status")).toContainText("items found");
  await expect(page.locator(".result-card").first()).toBeVisible();
});

test("no matches shows the empty state", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("searchbox", { name: "Search items" })
    .fill("zzz-definitely-not-a-real-item");
  await expect(page.getByRole("status")).toHaveText(
    "No items match your search.",
  );
  await expect(page.locator(".result-card")).toHaveCount(0);
});

test("category filter narrows results to that category only", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Filter by category").selectOption("Footwear");
  await expect(page).toHaveURL(/category=Footwear/);

  const categories = page.locator(".result-card [data-category]");
  await expect(categories.first()).toHaveText("Footwear");
  await expect(categories.filter({ hasNotText: "Footwear" })).toHaveCount(0);
});

test("price sort renders items in the order the server determined", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Filter by category").selectOption("Footwear");

  const sortedResponse = page.waitForResponse(
    (res) =>
      res.url().includes("/api/search") && res.url().includes("sort=price"),
  );
  await page.getByLabel("Sort by").selectOption("price");
  const response = await sortedResponse;
  await expect(page).toHaveURL(/sort=price/);

  // Sort key is basePrice (known without enrichment, per SOLUTION.md); the
  // *displayed* price has its own independent live variance, so two
  // close-priced items can display "out of order" even when correctly
  // sorted. Compare against what the server actually returned, not against
  // the noisy displayed price strings.
  const body = (await response.json()) as SearchResponse;
  await expect(page.locator(".result-card h2")).toHaveText(
    body.items.map((item) => item.name),
  );
});

test("pagination advances to the next page and keeps focus on the button", async ({
  page,
}) => {
  await page.goto("/");
  const nextButton = page.getByRole("button", { name: "Next" });
  await expect(nextButton).toBeEnabled();

  const itemNames = page.locator(".result-card h2");
  const firstPageFirstItem = await itemNames.first().textContent();

  await nextButton.click();
  await expect(page).toHaveURL(/page=2/);
  await expect(itemNames.first()).not.toHaveText(firstPageFirstItem ?? "");
  await expect(nextButton).toBeFocused();
});

test("Back returns to the previous page of results", async ({ page }) => {
  await page.goto("/");
  const pageLabel = page
    .getByRole("navigation", { name: "Pagination" })
    .getByText(/^Page \d+ of \d+$/);
  await expect(pageLabel).toHaveText(/^Page 1 of/);

  await page.getByRole("button", { name: "Next" }).click();
  await expect(pageLabel).toHaveText(/^Page 2 of/);

  await page.goBack();
  await expect(page).not.toHaveURL(/page=/);
  await expect(pageLabel).toHaveText(/^Page 1 of/);
});

test("a failed enrichment still shows the item, degraded rather than hidden", async ({
  page,
}) => {
  // Mock the API rather than relying on the upstream simulation's ~8% real
  // failure rate, so this assertion is deterministic instead of flaky.
  await page.route("**/api/search**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "mock-1",
            name: "Mock Failed Item",
            category: "Footwear",
            tags: ["trail"],
            basePopularity: 50,
            basePrice: 100,
            price: null,
            availability: null,
            deliveryEstimate: null,
            enrichmentFailed: true,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 12,
      } satisfies SearchResponse,
    }),
  );

  await page.goto("/");
  await expect(page.getByText("Mock Failed Item")).toBeVisible();
  await expect(page.locator(".result-card")).toHaveClass(/is-degraded/);
  await expect(page.locator("[data-price]")).toHaveText("Price unavailable");
});

test("typeahead shows suggestions and ArrowDown + Enter selects the first one", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();
  const options = listbox.getByRole("option");
  await expect(options.first()).toBeVisible();

  // The list is capped at 8 and opens with nothing highlighted, so one
  // ArrowDown highlights the first option.
  const firstSuggestion = (await options.first().textContent())?.trim() ?? "";
  await input.press("ArrowDown");
  await input.press("Enter");

  // The choice lands in the input, the URL, and the results.
  await expect(input).toHaveValue(firstSuggestion);
  await expect(page).toHaveURL(
    (url) => new URL(url).searchParams.get("q") === firstSuggestion,
  );
  await expect(
    page.getByRole("heading", { name: firstSuggestion }),
  ).toBeVisible();
  await expect(listbox).toBeHidden();
});

test("a single character never requests suggestions", async ({ page }) => {
  let suggestionRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/suggestions")) suggestionRequests++;
  });

  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search items" }).fill("t");
  await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden();

  // Let any (wrong) request past the 200ms debounce surface before asserting.
  await page.waitForTimeout(400);
  expect(suggestionRequests).toBe(0);
});

test("re-typing an answered prefix uses the memo, not a new request", async ({
  page,
}) => {
  let suggestionRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/suggestions")) suggestionRequests++;
  });

  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await page.waitForResponse((res) => res.url().includes("/api/suggestions"));
  await expect(listbox).toBeVisible();

  await input.fill("");
  await expect(listbox).toBeHidden();

  // Re-typing the same prefix is served from memory: no second request.
  await input.fill("trail");
  await expect(listbox).toBeVisible();

  await page.waitForTimeout(400);
  expect(suggestionRequests).toBe(1);
});

test("Escape hides the suggestions listbox", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();

  await input.press("Escape");
  await expect(listbox).toBeHidden();
});

// Delays the suggestion response so a request is reliably in flight while the
// test acts on the UI. This is what makes the stale-response race below
// deterministic rather than a matter of network timing.
async function delaySuggestions(page: Page, ms = 800): Promise<void> {
  await page.route("**/api/suggestions*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    // The page may have aborted the request (Escape, a memo hit) or closed
    // while it waited. That's expected, so it mustn't fail the test.
    await route.continue().catch(() => {});
  });
}

test("a stale suggestion response cannot re-open a dismissed listbox", async ({
  page,
}) => {
  await delaySuggestions(page);
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  // Past the 200ms debounce the request is in flight, but the (delayed)
  // response has not landed, so the list is still closed.
  await input.fill("trail");
  await page.waitForTimeout(400);

  // Dismiss while the request is in flight. The dismissal must abort it, so the
  // delayed response can no longer re-open the list.
  await input.press("Escape");
  await expect(listbox).toBeHidden();

  // Let the delayed response land; it must be ignored, not applied.
  await page.waitForTimeout(900);
  await expect(listbox).toBeHidden();
});

test("a stale suggestion response cannot overwrite a newer memo hit", async ({
  page,
}) => {
  await delaySuggestions(page);
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  // Prime the memo for "trail" (its delayed response lands) and record the
  // first suggestion, to prove the list still shows "trail" at the end.
  await input.fill("trail");
  await expect(listbox).toBeVisible();
  const trailFirst =
    (await listbox.getByRole("option").first().textContent())?.trim() ?? "";
  expect(trailFirst).not.toBe("");

  // Extend to "trailb", which matches nothing. Its (delayed) request goes in
  // flight while the list still shows the "trail" suggestions.
  await input.fill("trailb");
  await page.waitForTimeout(400); // past the 200ms debounce, request in flight

  // Backspace to "trail": a memo hit re-opens the "trail" suggestions instantly,
  // with no new request. The in-flight "trailb" response is now stale.
  await input.fill("trail");
  await page.waitForTimeout(400); // past the debounce, memo hit applied
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option").first()).toHaveText(trailFirst);

  // Let the stale "trailb" response land. Without the guard it would open its
  // (empty) result and close the list; with it, the "trail" list is untouched.
  await page.waitForTimeout(900);
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option").first()).toHaveText(trailFirst);
});

test("a suggestion response that lands after blur does not re-open the list", async ({
  page,
}) => {
  await delaySuggestions(page);
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  // Leave the field straight after typing. The 200ms debounce has not run yet,
  // so the request only goes out once the input has already lost focus, and
  // blur has closed the list before the response can land.
  await input.fill("trail");
  await input.blur();

  // Long enough for the debounce (200ms) and the delayed response (800ms).
  await page.waitForTimeout(1400);
  await expect(listbox).toBeHidden();
});

test("ArrowDown moves the highlight and Enter selects the highlighted option", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();
  const options = listbox.getByRole("option");
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  const second = (await options.nth(1).textContent())?.trim() ?? "";

  // The list opens with nothing highlighted; two ArrowDowns reach the second option.
  await input.press("ArrowDown");
  await input.press("ArrowDown");
  await expect(options.nth(1)).toHaveClass(/is-highlighted/);
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");

  await input.press("Enter");
  await expect(input).toHaveValue(second);
  await expect(page).toHaveURL(
    (url) => new URL(url).searchParams.get("q") === second,
  );
  await expect(listbox).toBeHidden();
});

test("clicking a suggestion selects it", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();
  const options = listbox.getByRole("option");
  expect(await options.count()).toBeGreaterThanOrEqual(2);
  const second = (await options.nth(1).textContent())?.trim() ?? "";

  await options.nth(1).click();
  await expect(input).toHaveValue(second);
  await expect(page).toHaveURL(
    (url) => new URL(url).searchParams.get("q") === second,
  );
  await expect(listbox).toBeHidden();
});

test("Enter with the list open searches the typed text, not a suggestion", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();

  await input.press("Enter");
  await expect(input).toHaveValue("trail");
  await expect(page).toHaveURL(
    (url) => new URL(url).searchParams.get("q") === "trail",
  );
  await expect(listbox).toBeHidden();
});

test("typing after highlighting an option drops the highlight", async ({
  page,
}) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();
  await input.press("ArrowDown");
  await expect(listbox.locator(".is-highlighted")).toHaveCount(1);

  // Enter lands before the 200ms debounce refreshes the list, so the list
  // still holds "trail" suggestions. It must search the new text instead.
  await input.pressSequentially(" running");
  await input.press("Enter");
  await expect(page).toHaveURL(
    (url) => new URL(url).searchParams.get("q") === "trail running",
  );
});

test("a slow click on a suggestion still selects it", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("trail");
  await expect(listbox).toBeVisible();
  const second = listbox.getByRole("option").nth(1);
  const name = (await second.textContent())?.trim() ?? "";

  // Holding the button down must not blur the input and close the list.
  await second.click({ delay: 300 });
  await expect(input).toHaveValue(name);
  await expect(input).toBeFocused();
});

test("the pointer and the keyboard share one highlight", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });

  await input.fill("shoe"); // 4 suggestions;
  await expect(listbox).toBeVisible();
  const options = listbox.getByRole("option");

  await input.press("ArrowDown");
  await expect(options.first()).toHaveClass(/is-highlighted/);

  await options.nth(2).hover();
  await expect(listbox.locator(".is-highlighted")).toHaveCount(1);
  await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");
});

test("opening the suggestions doesn't move the results", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("searchbox", { name: "Search items" });
  const listbox = page.getByRole("listbox", { name: "Suggestions" });
  const status = page.getByRole("status");

  await expect(status).toHaveText(/found/);
  const before = await status.boundingBox();

  await input.fill("trail");
  await expect(listbox).toBeVisible();
  expect((await status.boundingBox())?.y).toBe(before?.y);
});
