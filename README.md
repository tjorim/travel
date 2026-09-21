# Exampleland 2054 · Reisplan

Static single-page travel planner for the Taiwan trip in November and December 2026.

## Run locally

Open `dist/index.html` directly in a browser, or serve the project directory with any static web server.

For example:

```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080`.

## Deployment

Pushing to `main` deploys the contents of `dist/` to GitHub Pages.

## Structure

- `dist/index.html` — complete site: HTML, CSS, JavaScript, interactive map and itinerary
The page has no build step or package dependencies. One travel photograph is loaded from an external URL; all other visuals are embedded directly in the HTML.
