import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { choosePreferences, mockApi } from "./mock-api";

// Synthetic photos only: a landscape, a portrait and a very wide frame, repeated across updates of 1, 3 and 8 photos.
const frame = (index: number) =>
  index === 2 ? [2400, 400] : index % 2 ? [600, 1200] : [1600, 900];
const photo = (index: number, update: string) => ({
  id: `media-${index}`,
  image: { id: `media-${index}` },
  alt_text: `Synthetic photo ${index}`,
  caption: `Caption ${index}`,
  width: frame(index)[0],
  height: frame(index)[1],
  focal_x: 50,
  focal_y: 50,
  update,
});
const trip = {
  schema_version: "travel/public-trip@1",
  title: "Exampleland 2054",
  summary: "Three weeks around the island.",
  summary_html: "<p>Three weeks around the island.</p>",
  summary_text: "Three weeks around the island.",
  dates: null,
  cover: null,
  visits: [],
  places: [],
  updates: [
    { id: "update-one", title: "One photo", body: "Note.", body_html: "<p>Note.</p>" },
    { id: "update-three", title: "Three photos", body: "Note.", body_html: "<p>Note.</p>" },
    { id: "update-eight", title: "Eight photos", body: "Note.", body_html: "<p>Note.</p>" },
  ],
  stays: [],
  media: [
    photo(0, "update-one"),
    ...[1, 2, 3].map((i) => photo(i, "update-three")),
    ...[4, 5, 6, 7, 8, 9, 10, 11].map((i) => photo(i, "update-eight")),
  ],
  routes: [],
  navigation: [],
};
const svg = (index: number) => {
  const [width, height] = frame(index);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#6a8f7d"/></svg>`;
};

async function open(page: Page, locale: "nl" | "en", theme: "light" | "dark") {
  await mockApi(page);
  await page.route("**/api/public/trips/exampleland-2054", (route) =>
    route.fulfill({ json: trip }),
  );
  await page.route("**/api/public/trips/exampleland-2054/files/*", (route) => {
    const url = route.request().url();
    return route.fulfill({
      contentType: "image/svg+xml",
      body: svg(Number(url.split("media-")[1])),
    });
  });
  await choosePreferences(page, locale, theme);
  await page.goto("/trips/exampleland-2054");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

const words = {
  en: { open: "Open image: Synthetic photo", next: "Next photo", previous: "Previous photo" },
  nl: {
    open: "Afbeelding openen: Synthetic photo",
    next: "Volgende foto",
    previous: "Vorige foto",
  },
};
const position = (locale: "nl" | "en", current: number, total: number) =>
  locale === "en" ? `Photo ${current} of ${total}` : `Foto ${current} van ${total}`;

for (const locale of ["en", "nl"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`lightbox keys, buttons, focus and axe ${locale} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, locale, theme);
      const w = words[locale];
      // Only the eight-photo update, whose third photo is the first one opened.
      const trigger = page.getByRole("button", { name: `${w.open} 6` });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("img")).toHaveAttribute("alt", "Synthetic photo 6");
      await expect(dialog.getByText(position(locale, 3, 8))).toBeVisible();
      await expect(dialog.getByText("Caption 6")).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.keyboard.press("ArrowRight");
      await expect(dialog.getByRole("img")).toHaveAttribute("alt", "Synthetic photo 7");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      await expect(dialog.getByRole("img")).toHaveAttribute("alt", "Synthetic photo 5");
      await dialog.getByRole("button", { name: w.next }).click();
      await expect(dialog.getByText(position(locale, 3, 8))).toBeVisible();

      // The ends keep their button focusable but inert, so focus is never dropped.
      for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
      await expect(dialog.getByText(position(locale, 1, 8))).toBeVisible();
      const previous = dialog.getByRole("button", { name: w.previous });
      await expect(previous).toBeDisabled();
      await previous.focus();
      await expect(previous).toBeFocused();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      // Focus returns to the photo that was last shown, not the one opened.
      await expect(page.getByRole("button", { name: `${w.open} 7` })).toBeFocused();
    });
  }
}

test("one photo has no traversal controls and a wide or portrait frame fits", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "en", "light");
  await page.getByRole("button", { name: "Open image: Synthetic photo 0" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Next photo" })).toHaveCount(0);
  await expect(dialog.getByText(/Photo \d+ of/)).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img")).toHaveAttribute("alt", "Synthetic photo 0");
  await page.keyboard.press("Escape");
  // The three-photo update holds the very wide frame (2) and a portrait (1).
  await page.getByRole("button", { name: "Open image: Synthetic photo 2" }).click();
  await expect(dialog.getByText("Photo 2 of 3")).toBeVisible();
  const image = await dialog.getByRole("img").boundingBox();
  expect(image!.width).toBeLessThanOrEqual(1280);
  await page.keyboard.press("ArrowLeft");
  // The viewer is full-bleed, so a portrait photo may use the whole window height but never more.
  const portrait = await dialog.getByRole("img").boundingBox();
  expect(portrait!.height).toBeLessThanOrEqual(800);
  expect(portrait!.height).toBeGreaterThan(800 * 0.7);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  for (const locale of ["en", "nl"] as const) {
    test(`swiping the lightbox changes photo ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, locale, locale === "en" ? "light" : "dark");
      await page.getByRole("button", { name: `${words[locale].open} 5` }).tap();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(position(locale, 2, 8))).toBeVisible();
      // Tapping the button works before the synthetic drags below, which bypass Playwright's own touch state.
      await dialog.getByRole("button", { name: words[locale].next }).tap();
      await expect(dialog.getByText(position(locale, 3, 8))).toBeVisible();
      const client = await page.context().newCDPSession(page);
      // The figure fills the dialog; start inside the image.
      const box = (await dialog.getByRole("img").boundingBox())!;
      const y = box.y + box.height / 2;
      const drag = async (from: number, to: number) => {
        await client.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: from, y }],
        });
        await client.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: to, y }],
        });
        await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      };
      await drag(300, 100);
      await expect(dialog.getByText(position(locale, 4, 8))).toBeVisible();
      await drag(100, 300);
      await drag(100, 300);
      await expect(dialog.getByText(position(locale, 2, 8))).toBeVisible();
      // A short drag is not a swipe.
      await drag(200, 180);
      await expect(dialog.getByText(position(locale, 2, 8))).toBeVisible();
    });
  }
});

test("the lightbox is a dark full-bleed viewer with the caption over the photo and no language switch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "en", "light");
  await page.getByRole("button", { name: "Open image: Synthetic photo 6" }).click();
  const dialog = page.getByRole("dialog");
  const popup = (await dialog.boundingBox())!;
  expect(popup).toMatchObject({ x: 0, y: 0, width: 1280, height: 800 });
  await expect(dialog).toHaveCSS("background-color", "rgb(7, 14, 11)");
  // The caption is an overlay near the bottom of the viewer, on the photo, not a block under it.
  const caption = (await dialog.getByText("Caption 6").boundingBox())!;
  const image = (await dialog.getByRole("img").boundingBox())!;
  expect(caption.y).toBeGreaterThan(800 * 0.7);
  expect(caption.y + caption.height).toBeLessThanOrEqual(image.y + image.height + 1);
  // A photo's alt text and caption have no translation, so there is no Dutch/English switch inside the viewer.
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expect(dialog.getByText("Nederlands")).toHaveCount(0);
  await expect(dialog.getByText("Photo 3 of 8")).toBeVisible();
  // Escape closes it and focus returns to the thumbnail it opened from.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Open image: Synthetic photo 6" })).toBeFocused();
});

for (const width of [360, 1280]) {
  test(`updates with several photos show a larger first photo, a mosaic and the count ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "en", "light");
    // The three-photo update: a lead over two tiles, all inside the column.
    const three = page.getByRole("region", { name: /Media for update 2/ });
    await expect(three.getByText("3 photos")).toBeVisible();
    const boxes = await three.locator("[data-mosaic] > li").evaluateAll((items) =>
      items.map((item) => {
        const { x, y, width, height } = item.getBoundingClientRect();
        return { x, y, width, height };
      }),
    );
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.width).toBeGreaterThan(boxes[1]!.width * 1.8);
    expect(boxes[0]!.height).toBeGreaterThan(boxes[1]!.height * 1.5);
    expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 1);
    for (const box of boxes) expect(box.width).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    // The eight-photo update keeps every photo visible, one button each, with no hidden scrolling row.
    const eight = page.getByRole("region", { name: /Media for update 3/ });
    await expect(eight.getByText("8 photos")).toBeVisible();
    await expect(eight.getByRole("button", { name: /^Open image/ })).toHaveCount(8);
    await expect(eight.getByRole("button", { name: /Next photo|Previous photo/ })).toHaveCount(0);
    for (const tile of await eight.locator("[data-mosaic] > li").all())
      await expect(tile).toBeVisible();
    // A single photo keeps its large frame and shows no count.
    const one = page.getByRole("region", { name: /Media for update 1/ });
    await expect(one.locator("[data-mosaic]")).toHaveCount(0);
    await expect(one.getByText(/photos?$/)).toHaveCount(0);
  });
}
