<script setup lang="ts">
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  ShoppingBag,
  X,
  Plus,
  Minus,
  ShieldCheck,
  Package,
  Layers,
} from "lucide-vue-next";
const props = defineProps<{ shopPage?: boolean }>();
const { data, refresh } = await useFetch<any>("/api/shop/catalogue");
const products = computed<any[]>(() => data.value?.products || []);
const search = ref(""),
  club = ref(""),
  variant = ref(""),
  onlyStock = ref(false),
  page = ref(1),
  sort = ref("number");
const basketOpen = ref(false),
  busy = ref(false),
  notice = ref("");
const basket = ref<Record<number, number>>({});
const account = ref<{customer: {name:string}|null;csrf:string}|null>(null);
onMounted(() => {
  $fetch<any>('/account/session').then(value => {account.value=value;}).catch(() => {});
  try {
    const stored = JSON.parse(localStorage.getItem("toga-basket") || "{}");
    if (stored && typeof stored === "object" && !Array.isArray(stored))
      basket.value = Object.fromEntries(
        Object.entries(stored).filter(
          ([id, q]) =>
            /^\d+$/.test(id) && Number.isSafeInteger(q) && Number(q) > 0,
        ),
      );
  } catch {}
});
watch(
  basket,
  (v) => {
    if (import.meta.client)
      localStorage.setItem("toga-basket", JSON.stringify(v));
  },
  { deep: true },
);
watch([search, club, variant, onlyStock, sort], () => (page.value = 1));
const money = (p: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    p / 100,
  );
const clubs = computed(() =>
  [...new Set(products.value.map((c) => c.club))].sort(),
);
const variants = computed(() =>
  [...new Set(products.value.map((c) => c.variant))].sort(),
);
const results = computed(() => {
  const q = search.value.trim().toLowerCase(),
    numbers = q.split(/[ ,]+/).filter(Boolean);
  return products.value
    .filter(
      (c) =>
        (!q ||
          `${c.player} ${c.club} ${c.number} ${c.variant}`
            .toLowerCase()
            .includes(q) ||
          numbers.includes(c.number.toLowerCase())) &&
        (!club.value || c.club === club.value) &&
        (!variant.value || c.variant === variant.value) &&
        (!onlyStock.value || c.available > 0),
    )
    .sort((a, b) =>
      sort.value === "price"
        ? (a.price || Infinity) - (b.price || Infinity)
        : sort.value === "player"
          ? a.player.localeCompare(b.player)
          : a.number.localeCompare(b.number, "en", { numeric: true }),
    );
});
const visible = computed(() => results.value.slice(0, page.value * 12));
const featured = computed(() => {
  const picks = ["Bukayo Saka", "Erling Haaland", "Cole Palmer"];
  return picks
    .map((p) =>
      products.value.find((c) => c.player === p && c.variant === "Base"),
    )
    .filter(Boolean)
    .slice(0, 3).length === 3
    ? picks.map((p) =>
        products.value.find((c) => c.player === p && c.variant === "Base"),
      )
    : products.value.slice(0, 3);
});
const lines = computed(() =>
  Object.entries(basket.value)
    .map(([id, q]) => ({
      product: products.value.find((c) => c.id === Number(id)),
      quantity: q,
    }))
    .filter((l) => l.product),
);
const count = computed(() => lines.value.reduce((n, l) => n + l.quantity, 0));
const total = computed(() =>
  lines.value.reduce((n, l) => n + (l.product.price || 0) * l.quantity, 0),
);
const valid = computed(
  () =>
    lines.value.length > 0 &&
    lines.value.every(
      (l) => l.product.price && l.quantity <= l.product.available,
    ),
);
function add(c: any) {
  if ((basket.value[c.id] || 0) < c.available)
    basket.value[c.id] = (basket.value[c.id] || 0) + 1;
  basketOpen.value = true;
}
function change(id: number, n: number) {
  const v = (basket.value[id] || 0) + n;
  if (v <= 0) delete basket.value[id];
  else basket.value[id] = v;
}
async function checkout() {
  busy.value = true;
  notice.value = "";
  try {
    const wasSignedIn = !!account.value?.customer;
    account.value = await $fetch<any>('/account/session');
    if (wasSignedIn && !account.value?.customer) throw new Error('Please sign in again before checking out.');
    const signedIn = !!account.value?.customer;
    const r = await $fetch<any>(signedIn ? '/account/checkout' : "/api/shop/checkout", {
      method: "POST",
      ...(signedIn ? {headers:{'X-CSRF-TOKEN': account.value!.csrf, 'Accept':'application/json'}} : {}),
      body: {
        items: lines.value.map((l) => ({
          id: l.product.id,
          quantity: l.quantity,
        })),
      },
    });
    window.location.assign(r.url);
  } catch (e: any) {
    notice.value = e.data?.statusMessage || e.data?.message || e.message || "Checkout could not be opened.";
    await refresh();
  } finally {
    busy.value = false;
  }
}
const route = useRoute();
</script>
<template>
  <div class="store">
    <div class="announcement">
      Football cards. For your collection.
      <span>Premier League · Singles · Inserts · Set essentials</span>
    </div>
    <header class="shop-header">
      <NuxtLink to="/" class="wordmark"
        ><span class="brand-monogram">T</span>toga<span>cards</span></NuxtLink
      >
      <nav aria-label="Main navigation">
        <NuxtLink to="/shop">Shop all cards</NuxtLink
        ><a
          href="/shop?collection=set"
          @click.prevent="
            search = '';
            navigateTo('/shop');
          "
          >Complete your set</a
        ><a href="/#about">About Toga</a>
      </nav>
      <a class="account-link" :href="account?.customer ? '/account/orders' : '/account/login'">{{ account?.customer ? 'My account' : 'Sign in' }}</a>
      <button class="basket-button" @click="basketOpen = true">
        <ShoppingBag :size="19" /><span>Basket</span><b>{{ count }}</b>
      </button>
    </header>
    <div v-if="route.query.checkout === 'success'" class="shop-message">
      Thanks for visiting checkout. Your order is confirmed only once Stripe
      verifies payment. Please check your Stripe receipt.
    </div>
    <div v-if="route.query.checkout === 'cancelled'" class="shop-message">
      Checkout cancelled. Your basket is saved; reserved copies return when the
      checkout session expires.
    </div>
    <main>
      <section v-if="!shopPage" class="hero">
        <div class="hero-copy">
          <div class="eyebrow">THE FOOTBALL CARD COLLECTION</div>
          <h1>Your collection.<br /><em>Your next card.</em></h1>
          <p>
            Find your favourite players, explore the inserts and tick off
            the missing numbers. Football cards, all in one place.
          </p>
          <NuxtLink class="orange-button" to="/shop"
            >Shop the collection <ArrowRight :size="20"
          /></NuxtLink>
          <div class="hero-caption">
            TOPPS FLAGSHIP · PREMIER LEAGUE · 2026/27
          </div>
        </div>
        <div class="hero-art">
          <div class="collection-label">COLLECTION SPOTLIGHT <span>2026/27</span></div>
          <div
            v-for="(c, i) in featured"
            :key="c.id"
            class="hero-card"
            :class="`hero-card-${i}`"
          >
            <CardArtwork :card="c" :index="i" />
          </div>
          <div class="art-note">Premier League <span>Singles & inserts</span></div>
        </div>
      </section>
      <section v-if="!shopPage" class="shop-values">
        <span><Layers :size="20" /> Singles, inserts & set essentials</span
        ><span><Package :size="20" /> One basket. Combined postage.</span
        ><span><ShieldCheck :size="20" /> Clear prices & stock availability</span>
      </section>
      <section class="catalogue" id="catalogue">
        <div class="section-heading">
          <div>
            <div class="eyebrow">
              {{
                shopPage ? "THE TOGA CARDS SHOP" : "BROWSE THE COLLECTION"
              }}
            </div>
            <h2>
              {{
                shopPage
                  ? "Football cards"
                  : "Find your next addition"
              }}
            </h2>
          </div>
          <span class="catalogue-count"
            >{{ products.length.toLocaleString() }} catalogue entries</span
          >
        </div>
        <div class="catalogue-note">
          <span class="status-dot"></span>
          {{
            data?.demo
              ? "Shop preview · Demonstration stock and prices, separate from your real inventory."
              : "Browse the catalogue. Only cards with confirmed stock and a price are available to buy."
          }}
          Product photos appear where provided; labelled illustrations are catalogue previews.
        </div>
        <div class="shop-tools">
          <div class="search-box">
            <Search :size="19" /><input
              v-model="search"
              aria-label="Search catalogue"
              placeholder="Player, club or missing numbers: 1, 24, 108…"
            />
          </div>
          <select v-model="club" aria-label="Filter club">
            <option value="">All clubs</option>
            <option v-for="c in clubs" :key="c">{{ c }}</option></select
          ><select v-model="variant" aria-label="Filter card type">
            <option value="">All card types</option>
            <option v-for="v in variants" :key="v">{{ v }}</option>
          </select>
        </div>
        <div class="results-bar">
          <span>{{ results.length.toLocaleString() }} cards</span
          ><label
            ><input v-model="onlyStock" type="checkbox" /> In stock only</label
          ><select v-model="sort" aria-label="Sort cards">
            <option value="number">Card number</option>
            <option value="player">Player A–Z</option>
            <option value="price">Price: low to high</option>
          </select>
        </div>
        <div v-if="!results.length" class="empty-results">
          <Layers :size="36" />
            <h3>No cards found</h3>
          <p>Try a different search or turn off the in-stock filter.</p>
          <button
            @click="
              search = '';
              club = '';
              variant = '';
              onlyStock = false;
            "
          >
            Reset filters
          </button>
        </div>
        <div class="product-grid">
          <article v-for="(c, i) in visible" :key="c.id" class="product">
            <div class="product-image">
              <span class="product-badge">{{ c.variant }}</span
              ><CardArtwork :card="c" :index="i" />
            </div>
            <div class="product-meta">
              {{ c.club }} <span>#{{ c.number }}</span>
            </div>
            <h3>{{ c.player }}</h3>
            <p>{{ c.collection }} · {{ c.season }}</p>
            <div class="product-bottom">
              <strong
                >{{ c.price ? money(c.price) : "Catalogue preview"
                }}<small>{{
                  c.available
                    ? `${c.available} available`
                    : "Not currently for sale"
                }}</small></strong
              ><button
                :disabled="!c.available || (basket[c.id] || 0) >= c.available"
                :aria-label="`Add ${c.player} to basket`"
                @click="add(c)"
              >
                <Plus :size="19" />
              </button>
            </div>
          </article>
        </div>
        <button
          v-if="visible.length < results.length"
          class="load-more"
          @click="page++"
        >
          Load more cards <ArrowRight :size="18" />
        </button>
      </section>
      <section v-if="!shopPage" class="set-banner">
        <div>
          <div class="eyebrow">COMPLETE YOUR SET</div>
          <h2>A shorter checklist.<br />A fuller collection.</h2>
          <p>
            Got a list of missing numbers? Search them together and find the
            cards you need for your collection.
          </p>
          <NuxtLink to="/shop" class="text-link"
            >Explore the checklist <ArrowUpRight :size="20"
          /></NuxtLink>
        </div>
        <div class="binder">
          <div v-for="n in 6" :key="n" :class="{ missing: n === 3 || n === 5 }">
            <span>{{
              n === 3 || n === 5 ? "+" : String(n).padStart(3, "0")
            }}</span>
          </div>
        </div>
      </section>
      <section id="about" class="about-shop">
        <div class="eyebrow">ABOUT TOGA CARDS</div>
        <h2>Football cards, made simple.</h2>
        <p>
          An independent shop for football card collectors. Search by player,
          club or card number, find the singles you need and build your collection
          at your own pace.
        </p>
      </section>
    </main>
    <footer class="shop-footer">
      <NuxtLink to="/" class="wordmark"><span class="brand-monogram">T</span>toga<span>cards</span></NuxtLink
      ><span>Football cards. For your collection.</span
      ><a href="/admin">Admin sign in <ArrowUpRight :size="14" /></a
      ><small
        >Independent card shop. Not affiliated with Topps or the Premier
        League.</small
      >
    </footer>
    <div
      v-if="basketOpen"
      class="basket-overlay"
      @click.self="basketOpen = false"
    >
      <section
        class="basket-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping basket"
        @keydown.esc="basketOpen = false"
      >
        <header>
          <h2>
            Your basket <span>({{ count }})</span>
          </h2>
          <button aria-label="Close basket" @click="basketOpen = false">
            <X />
          </button>
        </header>
        <div v-if="!lines.length" class="empty-results">
          <ShoppingBag :size="36" />
          <h3>Your basket is empty</h3>
          <p>Your basket is empty. Explore the catalogue to get started.</p>
          <button @click="basketOpen = false">Keep exploring</button>
        </div>
        <div v-for="l in lines" :key="l.product.id" class="basket-line">
          <div>
            <strong>{{ l.product.player }}</strong>
            <p>#{{ l.product.number }} · {{ l.product.variant }}</p>
            <small>{{ money(l.product.price || 0) }} each</small>
            <p v-if="l.quantity > l.product.available" class="basket-error">
              Stock changed. Please reduce or remove this item.
            </p>
          </div>
          <div class="quantity">
            <button
              :aria-label="`Remove one ${l.product.player}`"
              @click="change(l.product.id, -1)"
            >
              <Minus :size="14" /></button
            >{{ l.quantity
            }}<button
              :disabled="l.quantity >= l.product.available"
              :aria-label="`Add one ${l.product.player}`"
              @click="change(l.product.id, 1)"
            >
              <Plus :size="14" />
            </button>
          </div>
        </div>
        <div v-if="lines.length" class="basket-totals">
          <p v-if="!account?.customer" class="checkout-note"><a href="/account/login">Sign in or create an account</a> to save this order in your order history. Guest checkout is also available.</p>
          <p>
            Cards <strong>{{ money(total) }}</strong>
          </p>
          <p>
            UK postage
            <strong>{{
              data?.checkoutReady ? money(data.shipping) : "To be configured"
            }}</strong>
          </p>
          <p v-if="data?.checkoutReady">
            Total <strong>{{ money(total + data.shipping) }}</strong>
          </p>
          <button
            class="orange-button"
            :disabled="!valid || !data?.checkoutReady || busy"
            @click="checkout"
          >
            {{ busy ? "Opening Stripe…" : "Checkout with Stripe"
            }}<ArrowRight :size="18" />
          </button>
          <p v-if="!data?.checkoutReady" class="checkout-note">
            Payments are not enabled in this preview. Your basket is saved on
            this device.
          </p>
          <p v-if="notice" role="alert" class="basket-error">{{ notice }}</p>
        </div>
      </section>
    </div>
  </div>
</template>
<style src="~/assets/storefront.css"></style>
