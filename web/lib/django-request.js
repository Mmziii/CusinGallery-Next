import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const REQUEST_TIMEOUT_MS = 20000;

// One concise server-side line per failure: path + status/cause, never the body.
function logFailure(source, path, detail) {
  console.error(`[${source}] GET ${path} failed: ${detail}`);
}

/**
 * Server-side GET to Django built on node:http(s) — deliberately NOT fetch:
 * undici silently drops a user-supplied Host header and sends the URL's
 * authority instead (e.g. "backend:8000"), which Django rejects with
 * DisallowedHost (400). http.request with `setHost: false` sends the incoming
 * public Host verbatim, so Django validates it against ALLOWED_HOSTS and builds
 * absolute media/image URLs against the public origin. Do not "simplify" this
 * back to fetch. Follows no redirects (3xx is treated as an error below).
 *
 * Shared by `lib/api-server.js` (server components) and `proxy.js` (the
 * not-found shim), which is why it lives in its own module: the API client
 * reads `next/headers`, which does not exist in the proxy runtime.
 */
export function djangoRequest(
  path,
  { host, proto, forwardedFor, cookie, timeout = REQUEST_TIMEOUT_MS, source = "api-server" } = {}
) {
  return new Promise((resolve, reject) => {
    const base = new URL(process.env.INTERNAL_API_URL || "http://backend:8000");
    const target = new URL(path, base);
    const isHttps = target.protocol === "https:";
    const requestHeaders = {
      Host: host,
      "X-Forwarded-Proto": proto,
      Accept: "application/json",
      // node:http does not decompress; ask the internal upstream for identity.
      "Accept-Encoding": "identity",
    };
    if (forwardedFor) requestHeaders["X-Forwarded-For"] = forwardedFor;
    if (cookie) requestHeaders.Cookie = cookie;

    let settled = false;
    const fail = (error, logDetail = error.code || error.message) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      logFailure(source, path, logDetail);
      reject(error);
    };

    const req = (isHttps ? httpsRequest : httpRequest)(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: target.pathname + target.search,
        method: "GET",
        headers: requestHeaders,
        setHost: false,
        timeout,
        // TLS SNI/verification must use the internal name, not the public Host.
        ...(isHttps ? { servername: target.hostname } : {}),
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", (error) => fail(error));
        res.on("end", () => {
          if (settled) return;
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            // Body is discarded on purpose: it is neither parsed nor logged.
            // The status rides along on the error so callers can turn a 404
            // into a real not-found page without parsing the message.
            const error = new Error(`Django ${path}: ${status}`);
            error.status = status;
            fail(error, status);
            return;
          }
          settled = true;
          clearTimeout(deadline);
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            logFailure(source, path, `${status} invalid JSON`);
            reject(new Error(`Django ${path}: ${status} invalid JSON`));
          }
        });
      }
    );
    // Total deadline (AbortSignal.timeout equivalent), on top of the socket
    // inactivity timeout above. destroy() re-enters via the "error" handler.
    const deadline = setTimeout(() => req.destroy(new Error(`Django ${path}: timeout`)), timeout);
    deadline.unref?.();
    req.on("timeout", () => req.destroy(new Error(`Django ${path}: timeout`)));
    req.on("error", (error) => fail(error, error.code || (error.message.includes("timeout") ? "timeout" : error.message)));
    req.end();
  });
}
