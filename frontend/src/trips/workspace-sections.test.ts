// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import { RECORD_KINDS } from "./record-focus";
import {
  DEFAULT_SECTION,
  isWorkspaceSection,
  resolveSection,
  sectionForRecord,
  sectionPath,
  WORKSPACE_SECTIONS,
} from "./workspace-sections";

describe("workspace sections", () => {
  it("opens the default section first, and lists every section once", () => {
    const ids = WORKSPACE_SECTIONS.map((section) => section.id);
    expect(ids[0]).toBe(DEFAULT_SECTION);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(isWorkspaceSection(id)).toBe(true);
    expect(isWorkspaceSection("details")).toBe(false);
  });

  it("gives every record kind exactly one block to open in", () => {
    const blocks = WORKSPACE_SECTIONS.flatMap((section) =>
      ("parts" in section ? section.parts : []).map((part) => ({ section: section.id, ...part })),
    );
    for (const kind of RECORD_KINDS) {
      const hosts = blocks.filter((block) => (block.records as readonly string[]).includes(kind));
      expect(
        hosts.map((block) => block.id),
        kind,
      ).toHaveLength(1);
      expect(sectionForRecord(kind)).toBe(hosts[0].section);
    }
  });

  it("gives every block a unique id, so a hash or the search names exactly one", () => {
    const ids = WORKSPACE_SECTIONS.flatMap((section) =>
      ("parts" in section ? section.parts : []).map((part) => part.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
    const tabs: string[] = WORKSPACE_SECTIONS.map((section) => section.id);
    for (const id of ids) expect(tabs).not.toContain(id);
  });

  it("sends records to the tab that hosts their editor", () => {
    expect(sectionForRecord("visit")).toBe("plan");
    expect(sectionForRecord("stay")).toBe("plan");
    expect(sectionForRecord("route")).toBe("plan");
    expect(sectionForRecord("area")).toBe("plan");
    expect(sectionForRecord("task")).toBe("prepare");
    expect(sectionForRecord("document")).toBe("prepare");
    expect(sectionForRecord("update")).toBe("story");
    expect(sectionForRecord("media")).toBe("story");
  });

  it("resolves the ids of tabs that were merged into others", () => {
    expect(resolveSection("plan")).toBe("plan");
    expect(resolveSection("packing")).toBe("packing");
    expect(resolveSection("media")).toBe("story");
    expect(resolveSection("details")).toBeNull();
    // An alias never shadows a real section.
    const ids: string[] = WORKSPACE_SECTIONS.map((section) => section.id);
    for (const section of WORKSPACE_SECTIONS)
      for (const alias of (section as { aliases?: readonly string[] }).aliases ?? [])
        expect(ids).not.toContain(alias);
  });

  it("links the overview to the trip itself and every other section below it", () => {
    expect(sectionPath("t 1", "overview")).toBe("/trips/t%201");
    expect(sectionPath("t 1", "plan")).toBe("/trips/t%201/plan");
  });

  it("labels every section", () => {
    for (const section of WORKSPACE_SECTIONS) expect(section.label().length).toBeGreaterThan(0);
  });
});
