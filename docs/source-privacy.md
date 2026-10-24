# Source privacy

Travel source is separate from the owner's application data. The owner's personal
VPS may retain real trips, documents, uploads, local archives and private recovery
copies. Keep that data out of the public Travel repository and its GitHub surfaces;
repository cleanup does not require deleting it from the personal instance.

Use invented trip
names, booking details and dates in tests, examples and browser evidence. Never
copy a production response, personal itinerary, booking document, export or
screenshot of an authenticated account into Git. Public place names and IANA
time-zone identifiers may be used to test geographic and daylight-saving rules;
they do not establish that the owner visited those places.

The fixture calendar uses invented future dates. When changing a date, preserve
the weekday and daylight-saving boundary the test exercises. Do not replace a
regression test with an assertion that merely repeats an implementation detail.
Run `python3 scripts/check-source-privacy.py` and
`python3 -m unittest discover -s scripts -p 'test_*.py'` before submitting source.
CI also checks tracked paths and recognizable credential formats, reporting only
paths and categories. This heuristic gate does not certify that arbitrary source or images are safe.
Keep review screenshots outside Git, even when their intended data is synthetic.

#499 owns the private inventory of source, history and GitHub-hosted content.
Store exact findings, pre-rewrite backups and replacement manifests outside all
source repositories with restricted permissions and explicit retention ownership.
Source deletion does not remove Git history, issue text, logs, caches or copies
held by collaborators. Revoke a live credential if one is found.

Before any history cutover, review the exact refs and expected old commit IDs,
the rehearsal results, open pull requests, deployment pins and collaborator
recovery instructions with the owner. Remote rewriting and repository visibility
changes each require an explicit owner decision. Never restore contaminated
history into a public repository as a recovery shortcut.
