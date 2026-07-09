import type { RequestHandler } from "@sveltejs/kit";

/**
 * GET /api/radio/proxy?url=<encoded-radio-stream-url>
 *
 * Proxies a live Shoutcast/Icecast radio stream so the Quest browser
 * can fetch it without CORS restrictions.
 *
 * Usage:
 *   <audio src="/api/radio/proxy?url=https://example.com/stream.mp3">
 *
 * The Audio element handles the streaming connection; we just
 * relay the upstream response with permissive CORS headers.
 */
export const GET: RequestHandler = async ({ url, fetch }) => {
  const targetUrl = url.searchParams.get("url");

  if (!targetUrl) {
    return new Response("Missing 'url' query parameter", { status: 400 });
  }

  try {
    new URL(targetUrl);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 15_000);

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        "Icy-MetaData": "0",
        "User-Agent": "Mozilla/5.0 (compatible; NeuralFlight-Radio/1.0)",
      },
      signal: abortController.signal,
    });

    if (!upstream.ok) {
      return new Response(`Upstream returned ${upstream.status}`, {
        status: upstream.status,
      });
    }

    const contentType =
      upstream.headers.get("Content-Type") ?? "audio/mpeg";

    return new Response(upstream.body, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "no-cache",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
};
