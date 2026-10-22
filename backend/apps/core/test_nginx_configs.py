"""
Static checks on the nginx edge configuration.

These tests read the real config files shipped in ``nginx/`` and assert
properties that a syntax check alone would not catch -- properties that
were found the hard way on a live server:

* A ``location`` regular expression containing ``{`` or ``}`` **must** be
  quoted. nginx's config parser does brace counting, so an unquoted
  pattern such as::

      location ~* ^/static/(.+\\.[a-f0-9]{12}\\.[^/]+)$ {

  is split at the first ``{`` and nginx then tries to compile
  ``^/static/(.+\\.[a-f0-9]{12`` as a regex, dying at startup with
  ``pcre2_compile() failed: missing closing parenthesis``. Quoting the
  pattern (``"..."``) makes the parser treat the whole thing as one token.
* The security headers every storefront response must carry, and the
  absence of the nginx version banner.
"""
import re
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

BACKEND_DIR = Path(settings.BASE_DIR)
NGINX_ROOT = BACKEND_DIR.parent / "nginx"

# Every server-level config this repo ships. The bootstrap file is an
# example, but it IS what runs on a fresh production box for the few
# minutes before the certificate exists -- it must be as correct as the
# permanent one.
NGINX_FILES = (
    NGINX_ROOT / "conf.d" / "cusin.conf",
    NGINX_ROOT / "prod.d" / "cusin.conf",
    NGINX_ROOT / "prod.d" / "00-bootstrap-http.conf.example",
)

# Server blocks that terminate TLS -- HSTS belongs here and ONLY here
# (sending Strict-Transport-Security over plain http is a no-op at best
# and misleading at worst).
TLS_CONFIGS = {NGINX_ROOT / "prod.d" / "cusin.conf"}

SECURITY_HEADERS = (
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
)


def strip_comments(text):
    """Drop ``#`` comments while leaving ``#`` inside quotes alone.

    Enough of a lexer for these hand-written files: they never use ``#``
    inside an unquoted token.
    """
    out = []
    for line in text.splitlines():
        cleaned = []
        quote = None
        index = 0
        while index < len(line):
            char = line[index]
            if quote:
                cleaned.append(char)
                if char == quote and line[index - 1: index] != "\\":
                    quote = None
            elif char in "\"'":
                quote = char
                cleaned.append(char)
            elif char == "#":
                break
            else:
                cleaned.append(char)
            index += 1
        out.append("".join(cleaned))
    return "\n".join(out)


def regex_locations(text):
    """Yield ``(modifier, pattern, quoted)`` for every regex ``location``.

    ``modifier`` is ``~`` or ``~*``; ``quoted`` is the quote character
    used (``"``/``'``) or ``""`` when the pattern was written bare.

    Deliberately LINE based, mirroring what nginx's own parser does: an
    unquoted token is cut at the first ``{``, so an unquoted
    ``^/static/(.+\\.[a-f0-9]{12}\\.[^/]+)$`` reaches pcre2 as
    ``^/static/(.+\\.[a-f0-9]``. Reading the whole line (up to the block
    brace) is what makes the truncated pattern visible to the test --
    a tokenizing helper would report the truncated, brace-free fragment
    and declare it fine.
    """
    locations = []
    for raw_line in strip_comments(text).splitlines():
        match = re.match(r"\s*location\s+(~\*?)\s+(\S.*)$", raw_line)
        if not match:
            continue
        modifier, rest = match.group(1), match.group(2).strip()
        if rest.startswith("\"") or rest.startswith("'"):
            quote = rest[0]
            end = rest.find(quote, 1)
            if end == -1:
                continue
            locations.append((modifier, rest[1:end], quote))
            continue
        # Unquoted: everything up to the block-opening brace is what
        # nginx tries to compile as a regex.
        body = rest.rstrip()
        if body.endswith("{"):
            body = body[:-1].rstrip()
        locations.append((modifier, body, ""))
    return locations


def _top_level_blocks(text, keyword):
    """Yield ``(header_line, body)`` for every ``server``/``location`` block.

    Indentation based, which is enough for these hand-written files: they
    are uniformly indented and every block's closing ``}`` sits at the
    block's own indent level.
    """
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        match = re.match(r"^(?P<indent>\s*)" + keyword + r"\b(?P<rest>.*?)\{\s*$", line)
        if not match:
            index += 1
            continue
        indent = len(match.group("indent"))
        header = (keyword + match.group("rest")).strip()
        body = []
        index += 1
        while index < len(lines):
            candidate = lines[index]
            if candidate.strip() == "}" and len(candidate) - len(candidate.lstrip()) == indent:
                break
            body.append(candidate)
            index += 1
        yield header, "\n".join(body)


def server_blocks(text):
    """Yield ``(block_text, terminates_tls)`` for every ``server`` block."""
    for header, body in _top_level_blocks(text, "server"):
        yield f"server {header}\n{body}", "listen 443" in f"{header}\n{body}"


def location_blocks(text):
    """Yield ``(header, body)`` for every ``location`` block in the file."""
    yield from _top_level_blocks(text, "location")


class NginxRegexQuotingTests(SimpleTestCase):
    def test_every_regex_location_containing_braces_is_quoted(self):
        """Regression: the collectstatic ``{12}`` hash pattern killed nginx.

        Unquoted, nginx's brace-counting parser ends the pattern at ``{``
        and pcre2 then sees ``^/static/(.+\\.[a-f0-9]{12`` -- "missing
        closing parenthesis" -- and the whole edge server refuses to
        start. Every regex location whose pattern contains a brace must
        therefore be written as a quoted token.
        """
        checked = 0
        for path in NGINX_FILES:
            source = path.read_text(encoding="utf-8")
            locations = regex_locations(source)
            self.assertTrue(locations, f"{path.name}: no regex location found at all")
            for modifier, pattern, quote in locations:
                with self.subTest(config=path.name, pattern=pattern):
                    if "{" in pattern or "}" in pattern:
                        self.assertNotEqual(
                            quote,
                            "",
                            f"{path.name}: regex location '{modifier} {pattern}' contains "
                            f"'{{' or '}}' but is NOT quoted -- nginx fails to start "
                            f"with pcre2_compile() failed: missing closing parenthesis",
                        )
                    checked += 1
        self.assertGreaterEqual(checked, len(NGINX_FILES))

    def test_unquoted_regex_locations_never_shadow_a_block_brace(self):
        """A bare pattern must not contain any brace at all, not just `}`."""
        for path in NGINX_FILES:
            for modifier, pattern, quote in regex_locations(path.read_text(encoding="utf-8")):
                with self.subTest(config=path.name, pattern=pattern):
                    if quote == "":
                        self.assertNotIn("{", pattern)
                        self.assertNotIn("}", pattern)
                        self.assertNotIn(";", pattern)

    def test_hashed_static_pattern_is_the_manifest_pattern(self):
        """The quoted pattern must still express Django's 12-hex suffix."""
        for path in NGINX_FILES:
            patterns = [pattern for _, pattern, _ in regex_locations(path.read_text(encoding="utf-8"))]
            with self.subTest(config=path.name):
                self.assertTrue(
                    any(
                        pattern.startswith("^/static/") and "[a-f0-9]{12}" in pattern
                        for pattern in patterns
                    ),
                    f"{path.name}: no hashed /static/ location found in {patterns}",
                )


class NginxSecurityHeaderTests(SimpleTestCase):
    """The storefront shipped no X-Frame-Options / X-Content-Type-Options /
    Referrer-Policy at all, and nginx happily printed its own version.

    Both are fixed at the edge, because the SPA's HTML never reaches
    Django -- Django's own SECURE_* settings cannot cover it.
    """

    def test_server_tokens_off(self):
        for path in NGINX_FILES:
            with self.subTest(config=path.name):
                self.assertIn(
                    "server_tokens off;",
                    strip_comments(path.read_text(encoding="utf-8")),
                )

    def test_security_headers_present_with_always(self):
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            for header in SECURITY_HEADERS:
                with self.subTest(config=path.name, header=header):
                    self.assertRegex(
                        source,
                        rf"add_header\s+{header}\s+[^;]*\balways\b\s*;",
                        f"{path.name}: '{header}' must be added with `always` "
                        f"(otherwise nginx drops it on error responses)",
                    )

    def test_hsts_only_in_tls_configs(self):
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            has_hsts = "Strict-Transport-Security" in source
            with self.subTest(config=path.name):
                if path in TLS_CONFIGS:
                    self.assertTrue(has_hsts, f"{path.name}: TLS server must send HSTS")
                else:
                    self.assertFalse(
                        has_hsts,
                        f"{path.name}: HSTS over plain HTTP is meaningless and must "
                        f"stay out of the non-TLS configs",
                    )

    def test_hsts_only_in_the_tls_server_block(self):
        """prod.d/cusin.conf has an :80 redirect server too -- no HSTS there."""
        source = strip_comments((NGINX_ROOT / "prod.d" / "cusin.conf").read_text(encoding="utf-8"))
        for block, tls in server_blocks(source):
            with self.subTest(server=block.splitlines()[0]):
                if tls:
                    self.assertIn("Strict-Transport-Security", block)
                else:
                    self.assertNotIn("Strict-Transport-Security", block)

    def test_every_location_owning_add_headers_repeats_the_security_headers(self):
        """nginx's add_header inheritance trap.

        `add_header` is inherited by a nested block ONLY when that block
        defines none of its own. Every location that sets Cache-Control
        therefore has to repeat the security headers, or a static asset
        (or the SPA shell, via the frontend container's own headers) goes
        out with no X-Frame-Options at all.
        """
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            for header, body in location_blocks(source):
                if "add_header" not in body:
                    continue  # inherits the server-level headers -- fine
                for name in SECURITY_HEADERS:
                    with self.subTest(config=path.name, location=header, header=name):
                        self.assertRegex(
                            body,
                            rf"add_header\s+{name}\s+[^;]*\balways\b\s*;",
                            f"{path.name}: location '{header}' sets its own add_header "
                            f"and so drops the server-level '{name}'",
                        )

    @staticmethod
    def _location_body(source, header, want="proxy_pass"):
        """Text of the location block whose body mentions ``want``.

        A config can hold several `location /` blocks (the TLS server's plain
        HTTP twin only redirects); picking the one that actually proxies is
        what makes these assertions about the real storefront block.
        """
        start = 0
        fallback = None
        while True:
            index = source.find(header, start)
            if index == -1:
                return fallback
            end = source.find("\n    }", index)
            block = source[index:end if end != -1 else len(source)]
            if want in block:
                return block
            if fallback is None:
                fallback = block
            start = index + len(header)

    def test_storefront_catch_all_reaches_the_next_app(self):
        """Phase 4: `location /` proxies the Next app (`http://web:3000`).

        Every storefront route (including owner-editable info pages and the
        unknown-path 404) is now rendered by Next, while legacy SPA static
        asset directories stay on `frontend_upstream` until phase 5 cleanup.
        """
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            block = self._location_body(source, "location / {")
            with self.subTest(config=path.name):
                self.assertIsNotNone(block, f"{path.name}: no `location /`")
                self.assertIn("proxy_pass http://web:3000;", block)
                self.assertIn("proxy_set_header Host $http_host;", block)
                self.assertIn("proxy_set_header X-Real-IP $remote_addr;", block)
                self.assertIn("proxy_set_header X-Forwarded-Proto $scheme;", block)
                self.assertIn("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;", block)
                self.assertIn("proxy_set_header X-Forwarded-Host $http_host;", block)
                self.assertNotIn("proxy_pass http://backend_upstream;", block)
                self.assertNotIn("proxy_pass http://frontend_upstream;", block)
            for asset in ("/assets/", "/fonts/", "/brand/"):
                with self.subTest(config=path.name, asset=asset):
                    self.assertRegex(
                        source,
                        r"location \^~ " + asset + r" \{[^}]*frontend_upstream",
                        f"{path.name}: the built bundle/fonts/brand files must be "
                        f"served by the frontend container",
                    )
            for favicon in ("/favicon.svg", "/favicon.ico"):
                with self.subTest(config=path.name, favicon=favicon):
                    self.assertRegex(
                        source,
                        r"location = " + re.escape(favicon) + r" \{[^}]*frontend_upstream",
                    )
            with self.subTest(config=path.name, next_assets="/_next/"):
                self.assertRegex(
                    source,
                    r"location \^~ /_next/ \{[^}]*http://web:3000",
                )

    def test_catalog_pages_are_served_by_the_next_app(self):
        """Phase 2: /shop/, /products/<slug>/ and /brands/<slug>/ are Next SSR.

        Next answers every visitor with real HTML (titles, Open Graph,
        JSON-LD), so the old crawler-only /seo/ rewrites were removed: a bot
        must NOT be diverted to Django while a human gets something else. All
        three paths therefore proxy the web container with the public Host and
        the X-Forwarded-* chain (Django builds absolute media URLs for the
        server-rendered page from those headers).
        """
        routes = ("^/shop/?$", "^/products/[^/]+/?$", "^/brands/[^/]+/?$",
                  "^/login/?$", "^/register/?$", "^/password-reset/?$",
                  "^/reset-password(?:/.*)?$", "^/account(?:/.*)?$", "^/wishlist/?$",
                  "^/cart/?$", "^/checkout/?$", "^/payment/result(?:/.*)?$")
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            for route in routes:
                body = self._location_body(source, f"location ~ {route}")
                with self.subTest(config=path.name, route=route):
                    self.assertIsNotNone(body, f"{path.name}: no location for {route}")
                    self.assertIn("proxy_pass http://web:3000;", body)
                    self.assertIn("proxy_set_header Host $http_host;", body)
                    self.assertIn("proxy_set_header X-Forwarded-Proto $scheme;", body)
                    self.assertIn("proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;", body)
                    self.assertNotIn("backend_upstream", body)
                    self.assertNotIn("frontend_upstream", body)
            # The bot-only diversion is gone from every stack (only the explicit
            # `location /seo/` backend block remains until phase 5).
            with self.subTest(config=path.name, block="crawler map"):
                self.assertNotIn("$cusin_is_bot", source)
                self.assertNotRegex(source, r"rewrite\s+[^\n]*/seo/")

    def test_auth_account_wishlist_keep_public_host_and_backend_routes(self):
        """Phase 3-4: storefront routes go to Next; every Django path stays on backend/volumes."""
        protected_django_samples = (
            "/api/",
            "/api/v1/products/",
            "/admin/",
            "/admin/login/",
            "/admin/products/product/image-import/",
            "/payment/callback/",
        )
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            for route in ("^/login/?$", "^/register/?$", "^/password-reset/?$",
                          "^/reset-password(?:/.*)?$", "^/account(?:/.*)?$", "^/wishlist/?$",
                          "^/cart/?$", "^/checkout/?$", "^/payment/result(?:/.*)?$"):
                body = self._location_body(source, f"location ~ {route}")
                with self.subTest(config=path.name, route=route):
                    self.assertIsNotNone(body)
                    self.assertIn("proxy_set_header X-Forwarded-Host $http_host;", body)
                    self.assertIn("proxy_set_header X-Real-IP $remote_addr;", body)
                    self.assertNotRegex("/payment/callback/", route)

            # No Next regex or non-root prefix location may match /api/, /admin/, or /payment/callback/.
            for header, body in location_blocks(source):
                if "http://web:3000" not in body:
                    continue
                spec = header[len("location"):].strip()
                if spec in ("/", "= /"):
                    continue
                with self.subTest(config=path.name, next_location=header):
                    if spec.startswith("~*"):
                        pattern = spec[2:].strip().strip("\"'")
                        for sample in protected_django_samples:
                            self.assertIsNone(re.search(pattern, sample, re.IGNORECASE))
                    elif spec.startswith("~"):
                        pattern = spec[1:].strip().strip("\"'")
                        for sample in protected_django_samples:
                            self.assertIsNone(re.search(pattern, sample))
                    else:
                        prefix = spec.lstrip("^~").strip()
                        for sample in protected_django_samples:
                            self.assertFalse(sample.startswith(prefix))

            for route in ("/api/", "/admin/", "/payment/callback/", "/seo/"):
                body = self._location_body(source, f"location {route}")
                with self.subTest(config=path.name, route=route):
                    self.assertIsNotNone(body, f"{path.name}: missing `location {route}`")
                    self.assertIn("backend_upstream", body)
                    self.assertNotIn("web:3000", body)

            for exact in ("/healthz", "/robots.txt", "/sitemap.xml"):
                body = self._location_body(source, f"location = {exact}")
                with self.subTest(config=path.name, route=exact):
                    self.assertIsNotNone(body, f"{path.name}: missing `location = {exact}`")
                    self.assertIn("backend_upstream", body)
                    self.assertNotIn("web:3000", body)

            for static_dir, alias_dir in (("/static/", "/app/staticfiles/"), ("/media/", "/app/media/")):
                body = self._location_body(source, f"location {static_dir}", want="alias")
                with self.subTest(config=path.name, route=static_dir):
                    self.assertIsNotNone(body, f"{path.name}: missing `location {static_dir}`")
                    self.assertIn(f"alias {alias_dir};", body)
                    self.assertNotIn("web:3000", body)

        for path in (NGINX_ROOT / "conf.d" / "cusin.conf", NGINX_ROOT / "prod.d" / "cusin.conf"):
            source = strip_comments(path.read_text(encoding="utf-8"))
            body = self._location_body(source, "location ^~ /admin/products/product/image-import/")
            with self.subTest(config=path.name, route="admin image-import"):
                self.assertIsNotNone(body)
                self.assertIn("backend_upstream", body)
                self.assertNotIn("web:3000", body)

    def test_seo_routes_reach_the_backend_in_every_config(self):
        """/robots.txt, /sitemap.xml and /seo/ are rendered by Django, not Next."""
        for path in NGINX_FILES:
            source = strip_comments(path.read_text(encoding="utf-8"))
            for route in ("/robots.txt", "/sitemap.xml"):
                with self.subTest(config=path.name, route=route):
                    self.assertRegex(
                        source,
                        rf"location\s+=\s+{route}\s*\{{[^}}]*backend_upstream",
                        f"{path.name}: {route} must be proxied to the backend",
                    )
            with self.subTest(config=path.name, route="/seo/"):
                self.assertRegex(
                    source,
                    r"location\s+/seo/\s*\{[^}]*backend_upstream",
                    f"{path.name}: /seo/ must be proxied to the backend",
                )
