// @vitest-environment happy-dom
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changeLocale } from "./locale";
import { VisitorNumbers } from "./VisitorNumbers";
import { ScopeEditor } from "./trips/publication/ScopeEditor";
import { m } from "./paraglide/messages.js";
import { cloneScope, emptyScope } from "./trips/publication/catalog";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("./auth-context", () => ({ useAuth: () => ({ session: null }) }));

afterEach(() => {
  cleanup();
  changeLocale("nl");
});
for (const locale of ["nl", "en"] as const) {
  it(`renders selected figures and zero with translated semantics (${locale})`, () => {
    changeLocale(locale);
    render(<VisitorNumbers numbers={{ days: 0, countries: 2 }} />);
    expect(screen.getByRole("region", { name: m.numbers_heading() })).toBeTruthy();
    expect(screen.getByText(m.numbers_days())).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.queryByText(m.numbers_nights())).toBeNull();
    expect(screen.getByText(m.numbers_help())).toBeTruthy();
  });
  it(`selects numbers without changing other scope choices (${locale})`, () => {
    changeLocale(locale);
    const scope = { ...emptyScope(), numbers: ["countries" as const] };
    let changed = scope;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ScopeEditor
          scope={scope}
          setScope={(value) => {
            changed = value as typeof scope;
          }}
          name="Synthetic audience"
          catalog={[]}
          hasDates={false}
          tripId="trip"
          onError={() => {}}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: m.numbers_days() }));
    expect(changed).toEqual({ ...scope, numbers: ["countries", "days"] });
    expect(cloneScope(changed).numbers).toEqual(["countries", "days"]);
    expect(cloneScope({ ...scope, numbers: [] }).numbers).toEqual([]);
  });
}
it("omits the strip for legacy scopes", () => {
  const { container } = render(<VisitorNumbers />);
  expect(container).toBeEmptyDOMElement();
});
