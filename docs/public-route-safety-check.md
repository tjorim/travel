# Public-route safety check

Run this short review before deploying any change that can be served without
authentication, including `dist/index.html`, `dist/<trip-slug>/`,
`dist/<trip-slug>/public/`, shared files in `dist/assets/`, and media those
pages reference. It is a content review, not a substitute for access control
on `private/` routes.

## Review before deployment

- [ ] List the public files changed in this deployment and open each new or
      edited data file, page, image, video, PDF, and other media asset. Do not
      rely only on a rendered-page preview.
- [ ] Check that no public content contains an exact accommodation, home, or
      meeting address; booking or confirmation code; ticket; QR code or
      barcode; travel-party name, contact detail, or relationship; document;
      live/near-real-time location; or other operational detail. Use broad
      city or region names and deliberately selected, non-live route data.
- [ ] For every newly public photo or media derivative, inspect the visible
      content and remove location metadata before committing it. When
      available, verify with `exiftool -gps:all -s <file>`; an empty result is
      expected. Also check that captions, filenames, and linked URLs do not
      reveal an operational detail.
- [ ] Keep public and private content separate on disk: public pages may load
      only deliberately selected files under their public route or shared
      browser assets. Put operational JSON, documents, original media, and
      focused itinerary data under `dist/private/` or
      `dist/<trip-slug>/private/`; never link, copy, or fetch them from a
      public page.
- [ ] Review the deployed page anonymously (signed out, in a private browser
      window) and confirm that its public URLs neither expose nor link to a
      protected file.

## If a public static page was exposed by mistake

1. Remove or replace the sensitive public file and deploy the correction
   immediately. Do not move the same URL to a protected file: a previously
   cached response can still be available.
2. Purge the affected URL from every CDN, proxy, and hosting cache. Check the
   response headers and cache layer after deployment; shorten or bypass caching
   for the corrected URL until the old response is gone.
3. Make the old public URL return `404` or `410` if it should no longer exist.
   If it must remain reachable temporarily for crawler removal, serve a blank
   replacement with `noindex` rather than the sensitive content, then remove
   it once search engines have processed the request.
4. Request removal of the affected URLs from the relevant search-engine
   webmaster tools, and treat any credentials, booking codes, or documents
   that were exposed as compromised according to their provider's procedure.
