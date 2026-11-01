import { expect, test } from "@playwright/test";

for (const path of ["/", "/trips/synthetic-story", "/share/synthetic-link"]) {
  test(`serves generic preview HTML on ${path}`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    const html = await response.text();
    expect(html).toContain('<meta property="og:title" content="Travel · Op reis"');
    expect(html).toContain('content="https://travel.tjor.im/admin/link-preview.png"');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(html).not.toContain("synthetic-story");
    expect(html).not.toContain("synthetic-link");
    if (path.startsWith("/share/")) {
      expect(response.headers()["cache-control"]).toBe("no-store, private");
      expect(response.headers()["referrer-policy"]).toBe("no-referrer");
      expect(response.headers()["x-robots-tag"]).toBe("noindex, noarchive");
    }
    const asset = await request.get("/admin/link-preview.png");
    expect(asset.ok()).toBe(true);
    expect(asset.headers()["content-type"]).toContain("image/png");
  });
}
