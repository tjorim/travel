import { describe, expect, it } from "vitest";
import { Button as BaseButton } from "@base-ui/react/button";
import { Input as BaseInput } from "@base-ui/react/input";
import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import { Progress as BaseProgress } from "@base-ui/react/progress";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn as originalCn } from "cn";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Collapsible } from "@/ui/collapsible";
import { Progress } from "@/ui/progress";
import { Dialog } from "@/ui/dialog";
import { cn } from "@/lib/utils";

describe("local UI imports preserve the existing primitive APIs", () => {
  it.each([
    ["Button", Button, BaseButton],
    ["Input", Input, BaseInput],
    ["Collapsible", Collapsible, BaseCollapsible],
    ["Progress", Progress, BaseProgress],
    ["Dialog", Dialog, BaseDialog],
  ])(
    "keeps %s as the original export, without extra wrappers or defaults",
    (_name, actual, expected) => {
      expect(actual).toBe(expected);
    },
  );

  it("keeps the existing class-merging implementation", () => {
    expect(cn).toBe(originalCn);
  });
});
