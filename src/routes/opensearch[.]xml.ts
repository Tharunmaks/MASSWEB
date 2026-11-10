import { createFileRoute } from "@tanstack/react-router";

/** Lets Chrome, Edge, Firefox and friends add Mass Search as a search engine. */
export const Route = createFileRoute("/opensearch.xml")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const origin = new URL(request.url).origin;
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
  <ShortName>Mass Search</ShortName>
  <Description>Independent web search by Mass Web. No ads, no tracking.</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/svg+xml">${origin}/favicon.svg</Image>
  <Url type="text/html" method="get" template="${origin}/search?q={searchTerms}"/>
  <Url type="application/x-suggestions+json" method="get" template="${origin}/suggest?q={searchTerms}&amp;format=opensearch"/>
  <moz:SearchForm>${origin}/search</moz:SearchForm>
</OpenSearchDescription>`;
        return new Response(xml, { headers: { "content-type": "application/opensearchdescription+xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
      },
    },
  },
});
