"""
Brand URL coverage that stays on Django after the storefront phases.

The brand PAGES themselves (/brands/<slug>/) are server-rendered by the
Next app (web/app/brands/[slug]/) -- what Django still owns is the
sitemap entry for each active brand, tested below. (The pre-Phase-5
revision of this module also pinned the SPA shell's brand 404s and the
retired /seo/brand/ crawler endpoint; both went away with the Vite
storefront in Phase 5.)
"""
from urllib.parse import quote
from xml.etree import ElementTree

from django.test import TestCase, override_settings

from apps.products.tests.helpers import make_brand


@override_settings(FRONTEND_URL="https://cusin.ir")
class BrandSitemapTests(TestCase):
    def test_sitemap_includes_only_active_brands_and_encodes_unicode(self):
        brand = make_brand(slug="برند-ایرانی")
        make_brand(slug="hidden", is_active=False)
        response = self.client.get("/sitemap.xml")
        tree = ElementTree.fromstring(response.content)
        namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        urls = [node.text for node in tree.findall("s:url/s:loc", namespace)]
        self.assertIn(f"https://cusin.ir/brands/{quote(brand.slug)}/", urls)
        self.assertNotIn("https://cusin.ir/brands/hidden/", urls)
        self.assertNotIn(f"https://cusin.ir/brands/{brand.slug}/", urls)
