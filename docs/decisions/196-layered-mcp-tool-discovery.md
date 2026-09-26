# Layered MCP tool discovery

## Decision

Travel's MCP server lists only a small entry surface and finds every other
tool by search, with FastMCP's `BM25SearchTransform`, the same pattern as
Worktime, Champagnefestival and Daynest (tjorim/apps#229):

- Always listed: `whoami`, `list_trips` and `get_trip_overview`, plus the
  synthetic `search_tools` and `call_tool`.
- `search_tools(query)` ranks the rest of the catalogue with BM25 over tool
  names, descriptions and top-level parameters, and returns at most five
  tools. Each result carries `name`, `description`, the self-contained
  `input_schema` a direct `tools/list` would send, and the tool's capability
  manifest entry (`effect`, `requires_confirmation`).
- `call_tool(name, arguments)` runs the chosen tool through the normal call
  path, so argument validation, ownership, `confirm=true` and auditing are
  exactly those of a direct call.

Listing all 94 tools cost about 138,000 characters (~35k tokens) in every
conversation that had the connector, used or not, and a long flat list went
stale in clients after deployments.

## Always-visible set

The siblings keep only `whoami`. Travel also keeps `list_trips` and
`get_trip_overview` because nearly every session starts by finding a trip and
reading its overview; keeping them listed saves a search round trip on the
most common path for a few hundred characters of schema.

## Result count

The siblings return ten results. Travel returns five: each result carries a
full input schema, and Travel's are large (an average of ~1,200 characters,
`batch_create` ~16,000), so ten could reach tens of thousands of characters in
one search. The tested task phrasings all rank their tool in the top five.

## Auditing through `call_tool`

A proxied tool passes through `ToolFailureMiddleware` twice: once as itself,
where a rejection is audited and reported under its own action with one
request reference, and once as `call_tool`, which passes that report on
unchanged. A rejected call therefore produces one audit row naming the inner
action (for example `visit.delete`, or `update_visit` for invalid arguments),
never a second `call_tool` row. An unknown tool name given to `call_tool` is
logged and answered with an error that points at `search_tools`; like an
unknown tool called directly it is not audited, since nothing ran.

## Search quality

BM25 ranks on words, so descriptions must name the task a tool serves. Tests
keep a table of real English and Dutch phrasings ("merge duplicate locations",
"locaties samenvoegen", "verblijf toevoegen", "noodnummers" and others) and
check that every hidden tool is found by its own name. A new tool whose
description does not rank for its obvious phrasing should be reworded, not
pinned.

## Consequences

- Clients approve `call_tool` as one tool, so "always allow" in a client
  covers reads and deletes alike. The safeguard for destructive and
  audience-changing actions remains Travel's preview plus `confirm=true`
  rule, enforced in the backend however a tool is reached; search results say
  which tools need it.
- The first use of a tool outside the entry surface costs one extra round
  trip.
- `/api/mcp/capabilities` still lists the full catalogue and reports the
  listed surface as `visible_tools`. The field is additive, so the shared
  contract version stays at 1.
- Hidden tools remain callable by name directly; the transform changes only
  what a client lists.
