import { Button } from "@base-ui/react/button";

import { useLocale } from "../../locale";
import { m } from "../../paraglide/messages.js";
import { RecordDialog } from "../../RecordDialog";

/** Shows a share link's URL once it is created or revealed, with a copy action. */
export function RevealedLinkDialog({
  link,
  onCopy,
  onClose,
}: {
  link: { label: string; url: string };
  onCopy: () => void;
  onClose: () => void;
}) {
  useLocale();
  return (
    <RecordDialog open title={m.assets_share_link_2()} onDismiss={onClose}>
      <section
        className="grid gap-2.5 rounded-xl border-2 border-travel-warning bg-travel-warning-surface p-4 text-travel-warning-dark [&_p]:m-0 [&_p]:text-travel-warning-dark! [&_code]:block [&_code]:wrap-anywhere [&_code]:rounded-lg [&_code]:bg-travel-surface [&_code]:p-2.5 [&_code]:text-sm [&_code]:text-travel-ink [&_button]:w-fit"
        aria-live="assertive"
      >
        <strong>{link.label}</strong>
        <p>{m.assets_anyone_with_this_link_can_open_the_active_hidden_page_you_can_copy_it_ag()}</p>
        <code>{link.url}</code>
        <Button type="button" onClick={onCopy}>
          {m.assets_copy_link()}
        </Button>
        <Button className="secondary compact" type="button" onClick={onClose}>
          {m.owner_close_2()}
        </Button>
      </section>
    </RecordDialog>
  );
}
