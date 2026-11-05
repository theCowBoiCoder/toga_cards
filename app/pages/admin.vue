<script setup lang="ts">
import {
  LayoutDashboard,
  Layers,
  ArrowUpRight,
  Plus,
  Search,
  ShoppingBag,
  Package,
  TrendingUp,
  ArrowDownToLine,
  X,
  CircleHelp,
  ArrowRight,
  Check,
  Wallet,
  SlidersHorizontal,
} from "lucide-vue-next";
import { Button } from "~/components/ui/button";
const {
  data,
  error: loadError,
  refresh,
} = await useFetch<any>("/api/inventory");
const tab = ref(useRoute().query.ebay ? "eBay" : "Inventory"),
  query = ref(""),
  stockFilter = ref("all"),
  clubFilter = ref("all");
const sectionFilter = ref("all"),
  page = ref(1);
const sections = computed(() =>
  [...new Set(cards.value.map((c) => c.variant))].sort(),
);
const modal = ref<HTMLDialogElement>(),
  action = ref("card"),
  saving = ref(false),
  error = ref(""),
  notice = ref("");
const form = reactive({
  player: "",
  club: "",
  season: "2026/27",
  collection: "Topps Flagship Premier League",
  number: "",
  variant: "Base",
  condition: "Near mint",
  quantity: 1,
  unitCost: 0,
  unitPrice: 0,
  fees: 0,
  date: today(),
  platform: "eBay",
  cardId: 0,
  expectedStock: 0,
});
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const cards = computed<any[]>(() => data.value?.cards || []);
const sales = computed<any[]>(() => data.value?.sales || []);
const sets = computed<any[]>(() => data.value?.sets || []);
const baseSet = computed(() =>
  sets.value.find((set) => set.section === "Base"),
);
const clubs = computed(() =>
  [...new Set(cards.value.map((c) => c.club))].sort(),
);
const filtered = computed(() =>
  cards.value.filter(
    (c) =>
      `${c.player} ${c.club} ${c.number} ${c.variant} ${c.collection} ${c.season}`
        .toLowerCase()
        .includes(query.value.toLowerCase()) &&
      (clubFilter.value === "all" || c.club === clubFilter.value) &&
      (sectionFilter.value === "all" || c.variant === sectionFilter.value) &&
      (stockFilter.value === "all" ||
        (stockFilter.value === "in"
          ? c.stock > 0
          : stockFilter.value === "low"
            ? c.stock > 0 && c.stock <= 2
            : c.stock === 0)),
  ),
);
const sortedCards = computed(() =>
  [...filtered.value].sort(
    (a, b) =>
      a.number.localeCompare(b.number, "en", { numeric: true }) ||
      a.variant.localeCompare(b.variant),
  ),
);
const pageCount = computed(() =>
  Math.max(1, Math.ceil(sortedCards.value.length / 50)),
);
const visibleCards = computed(() =>
  sortedCards.value.slice((page.value - 1) * 50, page.value * 50),
);
watch([query, clubFilter, stockFilter, sectionFilter], () => {
  page.value = 1;
});
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count);
});
const filteredSales = computed(() =>
  sales.value.filter((s) =>
    `${s.player} ${s.platform} ${s.number}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
const totalStock = computed(() => cards.value.reduce((n, c) => n + c.stock, 0));
const stockCost = computed(() =>
  cards.value.reduce((n, c) => n + c.stock_cost, 0),
);
const revenue = computed(() => sales.value.reduce((n, s) => n + s.gross, 0));
const profit = computed(() =>
  sales.value.reduce((n, s) => n + s.gross - s.fees - s.cost, 0),
);
const money = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    n / 100,
  );
const dateLabel = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
function open(kind: string, card?: any) {
  action.value = kind;
  error.value = "";
  Object.assign(form, {
    player: "",
    club: "",
    season: "2026/27",
    collection: "Topps Flagship Premier League",
    number: "",
    variant: "Base",
    condition: "Near mint",
    quantity: kind === "adjust" ? card.stock : 1,
    expectedStock: card?.stock || 0,
    unitCost:
      kind === "adjust" && card.stock
        ? Math.round(card.stock_cost / card.stock) / 100
        : 0,
    unitPrice: 0,
    fees: 0,
    date: today(),
    platform: "eBay",
    cardId:
      card?.id ||
      cards.value.find((c) => c.stock > 0)?.id ||
      cards.value[0]?.id ||
      0,
  });
  modal.value?.showModal();
}
async function save() {
  saving.value = true;
  error.value = "";
  try {
    data.value = await $fetch("/api/inventory", {
      method: "POST",
      body: {
        ...form,
        action: action.value,
        unitCost: Math.round(Number(form.unitCost) * 100),
        unitPrice: Math.round(Number(form.unitPrice) * 100),
        fees: Math.round(Number(form.fees) * 100),
      },
    });
    modal.value?.close();
    notice.value =
      action.value === "sale"
        ? "Sale recorded. Stock and profit updated."
        : action.value === "adjust"
          ? "Stock level saved."
          : "Card added to your collection.";
  } catch (e: any) {
    error.value = e.data?.statusMessage || "Could not save. Please try again.";
  } finally {
    saving.value = false;
  }
}
const quickAdding = ref<number | null>(null);
const quickAddError = ref("");
async function addOne(card: any) {
  if (quickAdding.value !== null || saving.value) return;
  quickAdding.value = card.id;
  quickAddError.value = "";
  try {
    data.value = await $fetch("/api/inventory", {
      method: "POST",
      body: {
        action: "stock",
        cardId: card.id,
        quantity: 1,
        unitCost: card.stock ? Math.round(card.stock_cost / card.stock) : 0,
        date: today(),
      },
    });
    notice.value = `Added 1 copy of ${card.player} (#${card.number}).`;
  } catch (e: any) {
    quickAddError.value =
      e.data?.statusMessage ||
      "Could not confirm the stock update. Refresh before trying again.";
  } finally {
    quickAdding.value = null;
  }
}
function exportCsv() {
  window.location.assign(
    `/api/export?kind=${tab.value === "Sales" ? "sales" : "inventory"}`,
  );
}
const selectedCard = computed(() =>
  cards.value.find((c) => c.id === form.cardId),
);
const colors = ["#d4e9df", "#dce3f4", "#efdfd5", "#e4def2", "#e7e9c9"];
</script>

<template>
  <ShopAdmin />
  <div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/" aria-label="Toga Cards home"
        ><span class="brand-icon"><Layers :size="23" /></span
        ><span>TOGA<span class="brand-light"> CARDS</span></span></a
      >
      <div class="workspace">
        <span class="workspace-icon">TC</span>
        <div>
          <strong>My collection</strong><small>Personal workspace</small>
        </div>
        <span class="muted">⌄</span>
      </div>
      <div class="eyebrow nav-label">Workspace</div>
      <nav>
        <button
          v-for="item in [
            { name: 'Overview', icon: LayoutDashboard },
            { name: 'Inventory', icon: Layers },
            { name: 'Sales', icon: ShoppingBag },
            { name: 'eBay', icon: ArrowUpRight },
          ]"
          :key="item.name"
          :class="{ active: tab === item.name }"
          @click="
            tab = item.name;
            query = '';
          "
          :aria-current="tab === item.name ? 'page' : undefined"
        >
          <component :is="item.icon" :size="18" />{{ item.name
          }}<span v-if="item.name === 'Inventory'" class="nav-count">{{
            cards.length
          }}</span>
        </button>
      </nav>
      <div class="sidebar-foot">
        <div class="collection-note">
          <span class="note-ball">◉</span
          ><strong>A collection worth keeping.</strong>
          <p>Every card. Every sale.<br />Your collection, in perspective.</p>
        </div>
        <div class="profile">
          <span class="avatar">TC</span>
          <div>
            <strong>TOGA collector</strong><small>Local workspace · GBP</small>
          </div>
          <span class="online" />
        </div>
      </div>
    </aside>
    <div class="main-wrap">
      <header class="topbar">
        <div class="breadcrumb">
          Workspace <span>/</span> <strong>{{ tab }}</strong>
        </div>
        <div class="local-label">
          <span class="online" /> Saved on this device
        </div>
      </header>
      <main>
        <div class="page-heading">
          <div>
            <div class="eyebrow">Your personal card room</div>
            <h1>
              {{
                tab === "Inventory"
                  ? "Your collection. All accounted for."
                  : tab === "eBay"
                    ? "Your listings, stock and sales."
                    : tab === "Sales"
                      ? "Every sale tells a story."
                      : "A clear view of your collection."
              }}
            </h1>
            <p class="muted">
              {{
                tab === "Sales"
                  ? "Track sale prices, selling fees and the profit you actually keep."
                  : "Keep track of your Topps Premier League cards, from first pack to final sale."
              }}
            </p>
          </div>
          <Button
            v-if="tab !== 'eBay'"
            @click="open(tab === 'Sales' ? 'sale' : 'card')"
            :disabled="tab === 'Sales' && !totalStock"
            ><Plus :size="16" />{{
              tab === "Sales" ? "Record sale" : "Add cards"
            }}</Button
          >
        </div>
        <div v-if="loadError" role="alert" class="error-box">
          Unable to load your collection.
          <button @click="refresh()">Retry</button>
        </div>
        <div v-if="notice" role="status" class="notice">
          <Check :size="16" />{{ notice
          }}<button aria-label="Dismiss notification" @click="notice = ''">
            <X :size="16" />
          </button>
        </div>
        <p v-if="quickAddError" role="alert" class="error-box">
          {{ quickAddError }}
        </p>
        <section class="metrics">
          <div class="panel metric">
            <div class="metric-top">Cards in stock <Package :size="17" /></div>
            <div class="metric-value">
              {{ totalStock.toLocaleString() }}<span>cards</span>
            </div>
            <div class="metric-foot">
              <span class="green">{{ cards.length }} unique cards</span
              ><span>in your collection</span>
            </div>
          </div>
          <div class="panel metric">
            <div class="metric-top">Inventory cost <Wallet :size="17" /></div>
            <div class="metric-value">{{ money(stockCost) }}</div>
            <div class="metric-foot">Purchase cost of your remaining stock</div>
          </div>
          <div class="panel metric">
            <div class="metric-top">
              Total sales <ArrowUpRight :size="18" />
            </div>
            <div class="metric-value">{{ money(revenue) }}</div>
            <div class="metric-foot">
              <span class="green"
                >{{ sales.length }}
                {{ sales.length === 1 ? "sale" : "sales" }}</span
              ><span>recorded to date</span>
            </div>
          </div>
          <div class="panel metric">
            <div class="metric-top">
              Realised profit <TrendingUp :size="17" />
            </div>
            <div
              class="metric-value"
              :class="profit < 0 ? 'negative' : 'green'"
            >
              {{ money(profit) }}
            </div>
            <div class="metric-foot">
              {{
                sales.some((s) => s.ebay_fees_confirmed === 0)
                  ? "Provisional: eBay fees awaiting review"
                  : "After card costs and selling fees"
              }}
            </div>
          </div>
        </section>
        <section
          v-if="tab !== 'Sales' && tab !== 'eBay' && baseSet"
          class="panel set-tracker"
        >
          <div class="section-heading">
            <div>
              <h2>Complete sets</h2>
              <p class="muted">2026/27 · Topps Flagship Premier League</p>
            </div>
            <strong class="green"
              >{{ baseSet.completeSets }} complete base
              {{ baseSet.completeSets === 1 ? "set" : "sets" }}</strong
            >
          </div>
          <div class="set-summary">
            <span
              >Next base set:
              <strong>{{ baseSet.nextSetOwned }} / {{ baseSet.total }}</strong>
              cards · {{ baseSet.nextSetMissing }} missing</span
            >
            <progress
              :value="baseSet.nextSetOwned"
              :max="baseSet.total"
              aria-label="Progress towards next complete base set"
            />
          </div>
          <details>
            <summary>
              View all {{ sets.length }} card types and set tallies
            </summary>
            <p class="set-explanation">
              A complete set needs one of every card; two sets need two of every
              card. Tallies use current stock and update after additions or
              sales. Base includes Future Stars #1–20. The Future Stars tally
              overlaps with Base, so these totals should not be added together.
              Only the imported official checklist is counted; custom parallels
              are not included.
            </p>
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Card type</th>
                    <th>Cards per set</th>
                    <th>Complete sets</th>
                    <th>Next set progress</th>
                    <th>Missing for next set</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="set in sets" :key="set.section">
                    <td>
                      {{
                        set.section === "Base"
                          ? "Base (including Future Stars)"
                          : set.section
                      }}
                    </td>
                    <td>{{ set.total }}</td>
                    <td>
                      <strong :class="set.completeSets ? 'green' : 'muted'">{{
                        set.completeSets
                      }}</strong>
                    </td>
                    <td>{{ set.nextSetOwned }} / {{ set.total }}</td>
                    <td>{{ set.nextSetMissing }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <EbayPanel v-if="tab === 'eBay'" :cards="cards" @updated="refresh()" />
        <section v-else-if="tab === 'Overview'" class="overview-grid">
          <div class="panel overview-panel">
            <div class="section-heading">
              <h2>Collection at a glance</h2>
              <Layers :size="19" />
            </div>
            <div v-if="!cards.length" class="overview-empty">
              Your collection starts with one card.<br /><Button
                class="mt-5"
                @click="open('card')"
                >Add your first card <ArrowRight :size="16"
              /></Button>
            </div>
            <div v-for="club in clubs" :key="club" class="club-row">
              <strong>{{ club }}</strong
              ><span
                >{{
                  cards
                    .filter((c) => c.club === club)
                    .reduce((n, c) => n + c.stock, 0)
                }}
                cards</span
              >
            </div>
          </div>
          <div class="panel overview-panel">
            <div class="section-heading">
              <h2>Recent sales</h2>
              <ShoppingBag :size="19" />
            </div>
            <p v-if="!sales.length" class="overview-empty">
              No sales yet. Record a sale from your inventory<br />and see how
              your collection is performing.
            </p>
            <div
              v-for="sale in sales.slice(0, 5)"
              :key="sale.id"
              class="club-row"
            >
              <div>
                <strong>{{ sale.player }}</strong
                ><small>{{ dateLabel(sale.date) }} · {{ sale.platform }}</small>
              </div>
              <strong class="green">{{
                money(sale.gross - sale.fees - sale.cost)
              }}</strong>
            </div>
          </div>
        </section>
        <section v-else class="panel inventory-panel">
          <div class="section-heading">
            <div class="section-title">
              <h2>
                {{ tab === "Inventory" ? "Card inventory" : "Sales history" }}
              </h2>
              <span class="pill">{{
                tab === "Inventory" ? cards.length : sales.length
              }}</span>
            </div>
            <Button variant="outline" size="sm" @click="exportCsv"
              ><ArrowDownToLine :size="14" />Export CSV</Button
            >
          </div>
          <div class="filters">
            <div class="search">
              <Search :size="17" /><input
                v-model="query"
                :placeholder="
                  tab === 'Inventory'
                    ? 'Search player, club or card number…'
                    : 'Search player or platform…'
                "
                aria-label="Search records"
              />
            </div>
            <template v-if="tab === 'Inventory'"
              ><select v-model="clubFilter" aria-label="Filter club">
                <option value="all">All clubs</option>
                <option v-for="club in clubs" :key="club">
                  {{ club }}
                </option></select
              ><select v-model="stockFilter" aria-label="Filter stock">
                <option value="all">All stock levels</option>
                <option value="in">In stock</option>
                <option value="low">Low stock (1–2)</option>
                <option value="out">Out of stock</option></select
              ><select v-model="sectionFilter" aria-label="Filter section">
                <option value="all">All sections</option>
                <option v-for="section in sections" :key="section">
                  {{ section }}
                </option>
              </select></template
            >
            <div class="filter-caption">
              <SlidersHorizontal :size="14" />{{
                tab === "Inventory" ? filtered.length : filteredSales.length
              }}
              results
            </div>
          </div>
          <div
            class="table-scroll"
            v-if="tab === 'Inventory' && filtered.length"
          >
            <table>
              <thead>
                <tr>
                  <th>Card / player</th>
                  <th>Collection</th>
                  <th>Variant</th>
                  <th>Stock</th>
                  <th>Avg. cost</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="card in visibleCards" :key="card.id">
                  <td>
                    <div class="card-cell">
                      <div
                        class="mini-card"
                        :style="{
                          '--card-color': colors[card.id % colors.length],
                        }"
                      >
                        <span>TOPPS</span
                        ><strong>{{
                          card.player
                            .split(" ")
                            .map((s: string) => s[0])
                            .slice(0, 2)
                            .join("")
                        }}</strong
                        ><small>#{{ card.number }}</small>
                      </div>
                      <div>
                        <strong>{{ card.player }}</strong
                        ><small
                          >{{ card.club }} <span>·</span> #{{
                            card.number
                          }}</small
                        >
                      </div>
                    </div>
                  </td>
                  <td>
                    <strong class="normal">{{ card.collection }}</strong
                    ><small>{{ card.season }}</small>
                  </td>
                  <td>
                    <span class="variant">{{ card.variant }}</span
                    ><small>{{ card.condition }}</small>
                  </td>
                  <td>
                    <div class="flex items-center gap-2">
                      <span
                        class="stock-badge"
                        :class="
                          card.stock === 0
                            ? 'empty-stock'
                            : card.stock <= 2
                              ? 'low-stock'
                              : ''
                        "
                        ><i />{{ card.stock }} in stock</span
                      >
                      <Button
                        variant="outline"
                        size="icon-sm"
                        :aria-label="`Add one copy of ${card.player}, ${card.number}, ${card.variant}`"
                        :title="`Add 1 copy at ${money(card.stock ? Math.round(card.stock_cost / card.stock) : 0)} cost`"
                        :disabled="quickAdding !== null || saving"
                        :aria-busy="quickAdding === card.id"
                        @click="addOne(card)"
                        ><Plus :size="15"
                      /></Button>
                    </div>
                  </td>
                  <td>
                    {{
                      money(
                        card.stock
                          ? Math.round(card.stock_cost / card.stock)
                          : 0,
                      )
                    }}
                  </td>
                  <td>
                    <div class="row-actions">
                      <Button
                        variant="outline"
                        size="sm"
                        @click="open('adjust', card)"
                        ><Plus :size="13" />Set stock</Button
                      ><Button
                        variant="ghost"
                        size="sm"
                        :disabled="!card.stock"
                        @click="open('sale', card)"
                        >Sell<ArrowUpRight :size="14"
                      /></Button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            class="table-scroll"
            v-else-if="tab === 'Sales' && filteredSales.length"
          >
            <table>
              <thead>
                <tr>
                  <th>Card / player</th>
                  <th>Date / platform</th>
                  <th>Quantity</th>
                  <th>Sale total</th>
                  <th>Fees</th>
                  <th>Card cost</th>
                  <th>Profit</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="sale in filteredSales" :key="sale.id">
                  <td>
                    <strong>{{ sale.player }}</strong
                    ><small>#{{ sale.number }} · {{ sale.variant }}</small>
                  </td>
                  <td>
                    {{ dateLabel(sale.date) }}<small>{{ sale.platform }}</small>
                  </td>
                  <td>{{ sale.quantity }}</td>
                  <td>{{ money(sale.gross) }}</td>
                  <td>
                    {{ money(sale.fees)
                    }}<small v-if="sale.ebay_fees_confirmed === 0"
                      >Awaiting eBay fee review</small
                    >
                  </td>
                  <td>{{ money(sale.cost) }}</td>
                  <td
                    :class="
                      sale.gross - sale.fees - sale.cost < 0
                        ? 'negative'
                        : 'green'
                    "
                  >
                    <strong>{{
                      money(sale.gross - sale.fees - sale.cost)
                    }}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-else class="empty-state">
            <div class="empty-art">
              <div class="decor-card back" />
              <div class="decor-card front">
                <Layers :size="35" /><span>YOUR NEXT FIND</span>
              </div>
            </div>
            <h3>
              {{
                query || stockFilter !== "all" || clubFilter !== "all"
                  ? "No matching records"
                  : tab === "Sales"
                    ? "Your first sale starts here"
                    : "Make room for your first card"
              }}
            </h3>
            <p>
              {{
                tab === "Sales"
                  ? "Record a sale to keep stock, fees and profit in sync."
                  : "Add your Premier League cards and know exactly what’s in your collection."
              }}
            </p>
            <Button v-if="!cards.length" @click="open('card')"
              ><Plus :size="16" />Add your first card</Button
            >
          </div>
          <div class="table-footer">
            <div v-if="tab === 'Inventory'" class="pagination">
              <Button
                variant="outline"
                size="sm"
                :disabled="page === 1"
                @click="page--"
                >Previous</Button
              ><span>Page {{ page }} of {{ pageCount }}</span
              ><Button
                variant="outline"
                size="sm"
                :disabled="page === pageCount"
                @click="page++"
                >Next</Button
              >
            </div>
            <span>{{
              tab === "Inventory"
                ? "Stock updates automatically when you record a sale."
                : "Profit = sale total − fees − allocated card cost."
            }}</span
            ><span>All amounts in GBP (£)</span>
          </div>
        </section>
        <div class="bottom-note">
          <CircleHelp :size="15" /><span
            >Built for the collection, not the guesswork.</span
          ><span class="bottom-right"
            >TOPPS PREMIER LEAGUE · COLLECTION TRACKER</span
          >
        </div>
      </main>
    </div>
    <dialog
      ref="modal"
      @click="
        (e: any) => {
          if (e.target === modal) modal?.close();
        }
      "
    >
      <div class="dialog-heading">
        <div>
          <div class="eyebrow">
            {{ action === "sale" ? "Track a sale" : "Build your collection" }}
          </div>
          <h2>
            {{
              action === "card"
                ? "Add a card"
                : action === "adjust"
                  ? "Set stock level"
                  : "Record a sale"
            }}
          </h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close dialog"
          @click="modal?.close()"
          ><X :size="18"
        /></Button>
      </div>
      <form @submit.prevent="save">
        <div class="form-grid">
          <template v-if="action === 'card'"
            ><label
              >Player<input
                v-model="form.player"
                required
                maxlength="150"
                placeholder="e.g. Cole Palmer" /></label
            ><label
              >Club<input
                v-model="form.club"
                required
                maxlength="150"
                placeholder="e.g. Chelsea" /></label
            ><label
              >Collection<input
                v-model="form.collection"
                required
                maxlength="150" /></label
            ><label
              >Season<input
                v-model="form.season"
                required
                maxlength="150" /></label
            ><label
              >Card number<input
                v-model="form.number"
                required
                maxlength="150"
                placeholder="e.g. 42" /></label
            ><label
              >Variant / parallel<input
                v-model="form.variant"
                required
                maxlength="150"
                placeholder="Base, Chrome, Gold…" /></label
            ><label
              >Condition<select v-model="form.condition">
                <option>Near mint</option>
                <option>Mint</option>
                <option>Excellent</option>
                <option>Good</option>
                <option>Played</option>
                <option>Graded</option>
              </select></label
            ></template
          >
          <label v-else class="full-width"
            >Card<select
              v-model="form.cardId"
              :disabled="action === 'adjust'"
              required
            >
              <option
                v-for="card in cards.filter(
                  (c) => action !== 'sale' || c.stock > 0,
                )"
                :key="card.id"
                :value="card.id"
              >
                {{ card.player }} · #{{ card.number }} · {{ card.variant }} ({{
                  card.stock
                }}
                available)
              </option>
            </select></label
          >
          <label
            >{{ action === "adjust" ? "Total copies you own" : "Quantity"
            }}<input
              v-model.number="form.quantity"
              type="number"
              :min="action === 'adjust' ? 0 : 1"
              :max="action === 'sale' ? selectedCard?.stock : 1000000"
              step="1"
              required
          /></label>
          <label v-if="action !== 'sale'"
            >{{
              action === "adjust"
                ? "Cost per additional copy (£)"
                : "Purchase price per card (£)"
            }}<input
              v-model.number="form.unitCost"
              type="number"
              min="0"
              max="1000000"
              step="0.01"
              required
          /></label>
          <template v-else
            ><label
              >Sold price per card (£)<input
                v-model.number="form.unitPrice"
                type="number"
                min="0"
                max="1000000"
                step="0.01"
                required /></label
            ><label
              >Total fees / postage (£)<input
                v-model.number="form.fees"
                type="number"
                min="0"
                :max="form.unitPrice * form.quantity"
                step="0.01"
                required /></label
            ><label
              >Sold on<input
                v-model="form.platform"
                required
                maxlength="150"
                placeholder="eBay, Vinted, card show…" /></label
          ></template>
          <label
            >{{ action === "sale" ? "Sale date" : "Purchase date"
            }}<input v-model="form.date" type="date" required
          /></label>
        </div>
        <div class="form-summary" v-if="action === 'sale'">
          Sale total
          <strong>{{
            money(Math.round(form.unitPrice * 100) * form.quantity)
          }}</strong
          ><small
            >Stock is deducted immediately. Fees cover the entire sale.</small
          >
        </div>
        <p v-else-if="action === 'adjust'" class="form-help">
          Currently {{ form.expectedStock }} copies. Enter your new total,
          including existing copies. Cost applies only to added copies; reducing
          stock removes its average cost without changing past sales.
        </p>
        <p v-else class="form-help">
          Purchase cost is used to calculate profit when you sell. Enter £0 for
          cards with no allocated cost.
        </p>
        <p v-if="error" role="alert" class="error-box">{{ error }}</p>
        <div class="dialog-actions">
          <Button type="button" variant="outline" @click="modal?.close()"
            >Cancel</Button
          ><Button type="submit" :disabled="saving">{{
            saving
              ? "Saving…"
              : action === "sale"
                ? "Save sale"
                : action === "adjust"
                  ? "Save stock level"
                  : "Add card"
          }}</Button>
        </div>
      </form>
    </dialog>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  width: 240px;
  background: #fff;
  border-right: 1px solid #e3e6eb;
  display: flex;
  flex-direction: column;
  position: fixed;
  inset: 0 auto 0 0;
  padding: 30px 19px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: -0.8px;
  color: inherit;
  text-decoration: none;
  padding: 0 9px;
}
.brand-light {
  font-weight: 450;
}
.brand-icon {
  background: #166c52;
  color: white;
  border-radius: 8px;
  width: 34px;
  height: 37px;
  display: grid;
  place-items: center;
}
.workspace {
  margin: 35px 0 30px;
  border: 1px solid #e5e8ec;
  border-radius: 8px;
  padding: 11px 9px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.workspace-icon,
.avatar {
  background: #edf1ef;
  color: #31624f;
  width: 31px;
  height: 33px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
}
.workspace strong {
  font-size: 12px;
}
.workspace small {
  font-size: 10px;
}
.workspace > span:last-child {
  margin-left: auto;
}
.nav-label {
  padding: 0 13px;
  margin-bottom: 12px;
  font-size: 10px;
}
nav {
  display: grid;
  gap: 5px;
}
nav button {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: 7px;
  background: transparent;
  border: 0;
  font: inherit;
  text-align: left;
  color: #727b8a;
}
nav button.active {
  background: #e9f3ed;
  color: #17674d;
  font-weight: 600;
}
.nav-count {
  margin-left: auto;
  background: #d8eade;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
}
.sidebar-foot {
  margin-top: auto;
  padding-top: 65px;
}
.collection-note {
  background: #f7f9f7;
  border: 1px solid #e7ece7;
  border-radius: 10px;
  padding: 17px 13px;
}
.note-ball {
  display: block;
  color: #266b50;
  font-size: 23px;
  margin-bottom: 12px;
}
.collection-note strong {
  font-size: 11px;
}
.collection-note p {
  color: #8a928f;
  line-height: 1.8;
  font-size: 11px;
  margin-bottom: 0;
}
.profile {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 25px;
  font-size: 11px;
}
.profile .online {
  margin-left: auto;
}
small {
  display: block;
  color: #84909e;
  font-size: 11px;
  margin-top: 5px;
  font-weight: 400;
}
.online {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4a9d73;
  display: inline-block;
}
.main-wrap {
  margin-left: 240px;
  width: calc(100% - 240px);
}
.topbar {
  height: 73px;
  background: #fff;
  border-bottom: 1px solid #e3e6eb;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 38px;
  font-size: 11px;
}
.breadcrumb {
  color: #8a929f;
}
.breadcrumb span {
  padding: 0 13px;
  color: #c2c8d0;
}
.breadcrumb strong {
  color: #455061;
  font-weight: 500;
}
.local-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #85918d;
}
main {
  max-width: 1640px;
  margin: auto;
  padding: 40px 38px;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  margin-bottom: 32px;
}
.page-heading h1 {
  font-size: 27px;
  letter-spacing: -1px;
  font-weight: 650;
  margin: 10px 0;
}
.page-heading p {
  font-size: 12px;
  margin: 0;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 17px;
  margin-bottom: 29px;
}
.metric {
  padding: 21px;
}
.metric-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #75808e;
  font-size: 11px;
}
.metric-top svg {
  color: #8e9b96;
}
.metric-value {
  font-size: 29px;
  letter-spacing: -1px;
  font-weight: 600;
  margin: 16px 0;
}
.metric-value > span {
  font-size: 12px;
  color: #929aa6;
  font-weight: 400;
  letter-spacing: 0;
  margin-left: 7px;
}
.metric-foot {
  display: flex;
  gap: 6px;
  font-size: 10px;
  color: #8a93a0;
}
.green {
  color: #187254;
}
.negative {
  color: #b42318;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 21px 23px;
  gap: 14px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 9px;
}
h2 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.pill {
  background: #f0f2f5;
  color: #788391;
  border-radius: 5px;
  padding: 2px 7px;
  font-size: 10px;
}
.filters {
  display: flex;
  gap: 11px;
  padding: 0 23px 22px;
}
.search {
  position: relative;
  flex: 1;
  max-width: 410px;
}
.search svg {
  position: absolute;
  left: 12px;
  top: 11px;
  color: #8e98a7;
}
.search input {
  padding-left: 37px;
  font-size: 11px;
  height: 39px;
}
.filters select {
  width: 145px;
  font-size: 11px;
  height: 39px;
}
.filter-caption {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  color: #929ba6;
  font-size: 10px;
}
.table-scroll {
  overflow: auto;
}
.card-cell {
  display: flex;
  align-items: center;
  gap: 13px;
}
.card-cell strong {
  font-size: 12px;
}
.card-cell small span {
  padding: 0 4px;
}
.mini-card {
  width: 37px;
  height: 49px;
  flex-shrink: 0;
  border: 2px solid white;
  outline: 1px solid #ddd;
  border-radius: 3px;
  background: linear-gradient(135deg, var(--card-color), #fff);
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  transform: rotate(-4deg);
  color: #465763;
}
.mini-card span {
  font-size: 5px;
  font-weight: 900;
  font-style: italic;
}
.mini-card strong {
  font-size: 13px;
}
.mini-card small {
  font-size: 6px;
  margin: 0;
  color: #596773;
}
.normal {
  font-weight: 450;
  font-size: 11px;
}
.variant {
  background: #f0f2f6;
  color: #637083;
  border-radius: 4px;
  padding: 3px 7px;
  font-size: 10px;
}
.stock-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 5px;
  background: #eef7f1;
  color: #317652;
  padding: 5px 7px;
  font-size: 10px;
}
.stock-badge i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
}
.low-stock {
  background: #fff7e9;
  color: #a77a2b;
}
.empty-stock {
  background: #f2f3f5;
  color: #8892a0;
}
.row-actions {
  display: flex;
  gap: 3px;
}
.table-footer {
  border-top: 1px solid #edf0f3;
  padding: 15px 23px;
  font-size: 10px;
  color: #8d96a3;
  display: flex;
  justify-content: space-between;
  gap: 15px;
}
.bottom-note {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #929ba8;
  font-size: 10px;
  margin-top: 22px;
}
.bottom-right {
  margin-left: auto;
  font-size: 8px;
  letter-spacing: 1.2px;
}
.empty-state {
  padding: 36px 20px 55px;
  text-align: center;
  border-top: 1px solid #edf0f3;
}
.empty-art {
  height: 137px;
  position: relative;
  width: 140px;
  margin: 0 auto 13px;
}
.decor-card {
  position: absolute;
  width: 79px;
  height: 108px;
  border-radius: 7px;
  border: 1px solid #c3d9ce;
  left: 33px;
  top: 10px;
}
.back {
  background: #e0eae5;
  transform: rotate(-17deg);
  left: 15px;
  top: 15px;
}
.front {
  background: linear-gradient(145deg, #f3f9f5, #d9eade);
  transform: rotate(9deg);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 15px;
  color: #417b60;
  box-shadow: 0 4px 8px #183c1910;
}
.front span {
  font-size: 6px;
  letter-spacing: 1px;
}
.empty-state h3 {
  font-size: 19px;
  letter-spacing: -0.4px;
  margin: 5px 0;
}
.empty-state p {
  font-size: 12px;
  color: #8a93a0;
  margin: 10px 0 22px;
}
.dialog-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.dialog-heading h2 {
  font-size: 23px;
  margin-top: 8px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
  margin-top: 24px;
}
.full-width {
  grid-column: 1/-1;
}
.form-help {
  font-size: 11px;
  color: #8a93a0;
  line-height: 1.7;
  margin-top: 20px;
}
.form-summary {
  background: #f1f6f3;
  padding: 15px;
  border-radius: 8px;
  margin-top: 20px;
}
.form-summary strong {
  float: right;
}
.error-box {
  background: #fff0ed;
  color: #a32318;
  padding: 12px;
  border-radius: 8px;
  margin-bottom: 16px;
  font-size: 12px;
}
.notice {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 12px 16px;
  background: #eaf5ed;
  color: #246b47;
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 12px;
}
.notice button {
  margin-left: auto;
}
.overview-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
.overview-empty {
  padding: 45px 20px;
  text-align: center;
  line-height: 1.8;
  color: #8a93a0;
  font-size: 13px;
}
.club-row {
  padding: 17px 23px;
  border-top: 1px solid #edf0f3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}
.club-row > span {
  color: #87909f;
}
@media (min-width: 1600px) {
  main {
    padding-top: 48px;
  }
  .empty-state {
    padding-bottom: 80px;
    padding-top: 60px;
  }
}
@media (max-width: 1150px) {
  .sidebar {
    width: 205px;
  }
  .main-wrap {
    margin-left: 205px;
    width: calc(100% - 205px);
  }
  main {
    padding: 28px 22px;
  }
  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .page-heading h1 {
    font-size: 23px;
  }
  .filters {
    flex-wrap: wrap;
  }
  .filter-caption {
    display: none;
  }
}
@media (max-width: 760px) {
  .sidebar {
    position: static;
    width: 100%;
    padding: 15px;
    border-right: 0;
    border-bottom: 1px solid #e3e6eb;
  }
  .shell {
    display: block;
  }
  .brand {
    font-size: 16px;
  }
  .workspace,
  .nav-label,
  .sidebar-foot {
    display: none;
  }
  nav {
    display: flex;
    margin-top: 15px;
  }
  nav button {
    flex: 1;
    font-size: 12px;
    justify-content: center;
    padding: 10px 7px;
  }
  .main-wrap {
    margin: 0;
    width: 100%;
  }
  .topbar {
    height: 49px;
    padding: 0 20px;
  }
  .local-label {
    font-size: 9px;
  }
  main {
    padding: 26px 16px;
  }
  .page-heading {
    align-items: flex-start;
  }
  .page-heading h1 {
    font-size: 22px;
    line-height: 1.25;
  }
  .page-heading p {
    line-height: 1.7;
  }
  .page-heading > button {
    font-size: 11px;
    padding: 8px;
    flex-shrink: 0;
  }
  .metrics {
    gap: 10px;
  }
  .metric {
    padding: 15px;
  }
  .metric-value {
    font-size: 26px;
  }
  .metric-foot {
    font-size: 9px;
    flex-wrap: wrap;
  }
  .filters {
    padding: 0 15px 15px;
    gap: 8px;
  }
  .search {
    flex-basis: 100%;
    max-width: 100%;
  }
  .filters select {
    flex: 1;
  }
  .section-heading {
    padding: 18px 15px;
  }
  .table-footer {
    padding: 12px 15px;
    line-height: 1.6;
  }
  .bottom-right {
    display: none;
  }
  .empty-state p {
    line-height: 1.7;
  }
  .overview-grid {
    grid-template-columns: 1fr;
  }
  .eyebrow {
    font-size: 9px;
  }
}
</style>
