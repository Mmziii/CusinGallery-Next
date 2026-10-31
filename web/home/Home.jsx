import { Link } from "../lib/navigation";
import BrandTiles from "../components/BrandTiles";
import SmartImage from "../components/SmartImage";
import RecentlyViewed from "../components/RecentlyViewed";
import { mainGroups } from "../utils/categories";
import { HeroSlider, TrustStrip, DailyDealsSection, ProductRow, ReviewHighlights, BrandStory, RevealSection } from "./HomeInteractive";

export default function Home({ initialData, content }) {

  const homeCopy = content.home || {};
  const sections = homeCopy.sections || {};
  const hero = homeCopy.hero || {};
  // An empty owner list means "hide the strip" (a real payload is the only
  // way to get []); a failed request yields the default payload instead.
  const trustItems = content.trust_strip || [];
  const bannersState = { data: initialData.banners };
  const categoriesState = { data: initialData.categories };
  const bestSellersState = { data: initialData.reviewProducts };
  // Stage 1: the tiles show the main groups (children of
  // the «آشپزخانه» root), never the root itself.
  const categoryGroups = mainGroups(categoriesState.data || []);

  return (
    <div className="home">
      <h1 className="sr-only">{homeCopy.heading || "کازین گالری؛ فروشگاه لوازم خانه و آشپزخانه"}</h1>
      <HeroSlider
        banners={bannersState.data || []}
        isLoading={bannersState.isLoading}
        hero={hero}
      />
      <TrustStrip items={trustItems} />

      {categoryGroups.length ? (
        <RevealSection className="section container reveal">
          <div className="section__head">
            <h2>{sections.categories || "دسته‌بندی‌ها"}</h2>
            <span className="section__rule" aria-hidden="true" />
          </div>
          <div className="category-grid">
            {categoryGroups.map((category) => (
              <Link
                key={category.id}
                to={`/shop/?category=${encodeURIComponent(category.slug)}`}
                className="category-card"
              >
                {/* Part S4 item 1: category tiles go through the shared
                    image component -- a category without an image (or with
                    a broken file) shows our logo placeholder, never an
                    empty span or a broken-image icon. */}
                <span className="category-card__media">
                  <SmartImage image={category.image} alt="" sizes="(max-width: 767px) 31vw, 180px" />
                </span>
                <span className="category-card__name">{category.name}</span>
              </Link>
            ))}
          </div>
        </RevealSection>
      ) : null}

      <DailyDealsSection data={initialData.deals} title={sections.deals || "پیشنهاد امروز"} />

      <BrandTiles data={initialData.brands} />

      <ProductRow data={initialData.featured} title={sections.featured || "محصولات منتخب"} params={{ is_featured: true }} />
      <ProductRow data={initialData.new} title={sections.new || "جدیدترین محصولات"} params={{ is_new: true }} />
      <ProductRow data={initialData.best_sellers} title={sections.best_sellers || "پرفروش‌ترین‌ها"} params={{ is_best_seller: true }} />
      {bestSellersState.data?.results?.length ? (
        <ReviewHighlights data={initialData.reviews}
          products={bestSellersState.data.results}
          title={sections.reviews || "از زبان خریداران"}
        />
      ) : null}
      <RecentlyViewed />
      <BrandStory story={homeCopy.story || {}} />
    </div>
  );
}
