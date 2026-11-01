// @vitest-environment happy-dom
// @vitest-environment-options {"happyDOM":{"handleDisabledFileLoadingAsSuccess":true}}
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const output = mkdtempSync(join(tmpdir(), "travel-visitor-metadata-"));
const root = process.cwd();
const image = "https://travel.tjor.im/admin/link-preview.png";
const description = "Privé, bewuste reisverhalen.";
const metadata = {
  description,
  viewport: "width=device-width, initial-scale=1.0",
  referrer: "no-referrer",
  robots: "noindex, noarchive",
  "theme-color": "#12342c",
  "og:site_name": "Travel",
  "og:type": "website",
  "og:locale": "nl_BE",
  "og:title": "Travel · Op reis",
  "og:description": description,
  "og:image": image,
  "og:image:type": "image/png",
  "og:image:width": "1200",
  "og:image:height": "630",
  "og:image:alt": "Travel",
  "twitter:card": "summary_large_image",
  "twitter:title": "Travel · Op reis",
  "twitter:description": description,
  "twitter:image": image,
  "twitter:image:alt": "Travel",
};

beforeAll(() => {
  // Check delivered HTML and copied assets, not just the source templates.
  execFileSync("pnpm", ["exec", "vite", "build", "--outDir", output], {
    cwd: root,
    stdio: "pipe",
    env: { ...process.env, TRAVEL_DEV_AUTH_BYPASS_TOKEN: "" },
  });
}, 120_000);
afterAll(() => rmSync(output, { recursive: true, force: true }));

describe("built visitor link previews", () => {
  for (const [shell, title] of [
    ["landing", "Travel · Op reis"],
    ["public", "Reis · Travel"],
    ["share", "Gedeelde reis · Travel"],
  ]) {
    it(`${shell} contains only generic metadata and a data-free root`, () => {
      const html = readFileSync(join(output, `${shell}.html`), "utf8");
      const page = new DOMParser().parseFromString(html, "text/html");
      expect(page.documentElement.lang).toBe("nl");
      expect(page.title).toBe(title);
      const tags = [...page.querySelectorAll("meta[name], meta[property]")];
      expect(tags).toHaveLength(Object.keys(metadata).length);
      expect(
        Object.fromEntries(
          tags.map((tag) => [
            tag.getAttribute("name") ?? tag.getAttribute("property"),
            tag.getAttribute("content"),
          ]),
        ),
      ).toEqual(metadata);
      expect(page.querySelector("meta[charset]")?.getAttribute("charset")).toBe("UTF-8");
      expect(page.querySelector('link[rel="icon"]')?.getAttribute("href")).toBe("/admin/icon.svg");
      // Never install the owner manifest or publish the current capability URL.
      expect(page.querySelector('link[rel="manifest"], link[rel="canonical"]')).toBeNull();
      expect(page.body.textContent?.trim()).toBe("");
      expect(page.body.children).toHaveLength(1);
      expect(page.body.firstElementChild?.outerHTML).toBe('<div id="root"></div>');
      for (const script of page.scripts) {
        expect(script.textContent).toBe("");
        expect(script.getAttribute("src")).toMatch(
          /^\/admin\/(?:assets\/[\w.-]+\.js|locale\.js|appearance\.js)$/,
        );
      }
      expect(html.indexOf('name="referrer"')).toBeLessThan(html.indexOf('property="og:image"'));
      expect(html.indexOf('name="referrer"')).toBeLessThan(html.indexOf("<script"));
    });
  }
  it("ships the generic PNG and favicon without embedded image metadata", () => {
    const png = readFileSync(join(output, "link-preview.png"));
    expect(png.equals(readFileSync(join(root, "public/link-preview.png")))).toBe(true);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    const chunks: string[] = [];
    for (let offset = 8; offset < png.length;) {
      chunks.push(png.toString("ascii", offset + 4, offset + 8));
      offset += png.readUInt32BE(offset) + 12;
    }
    expect(chunks.every((chunk) => ["IHDR", "IDAT", "IEND"].includes(chunk))).toBe(true);
    expect(readFileSync(join(output, "icon.svg"), "utf8")).toBe(
      readFileSync(join(root, "public/icon.svg"), "utf8"),
    );
  });
});
