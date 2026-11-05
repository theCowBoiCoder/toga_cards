<script setup lang="ts">
import { Button } from "~/components/ui/button";
const props = defineProps<{ cards: any[] }>();
const emit = defineEmits<{ updated: [] }>();
const connectionOutcome = useRoute().query.ebay;
const {
  data,
  status,
  error: loadError,
  refresh,
} = await useFetch<any>("/api/ebay");
const busy = ref(false),
  error = ref(""),
  notice = ref(""),
  ruName = ref(""),
  query = ref(""),
  view = ref("listings");
const mapping = reactive<Record<string, number>>({}),
  fees = reactive<Record<string, number>>({});
const money = (p: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    p / 100,
  );
const cardName = (id: number) => {
  const c = props.cards.find((c) => c.id === id);
  return c ? `${c.player} · #${c.number} · ${c.variant} · ${c.club} · ${c.season} · ${c.condition}` : "Unmatched";
};
const keyFor = (row: any) =>
  JSON.stringify([row.itemId, row.sku, row.sku ? "" : row.variation]);
const showMatched = ref(false);
const filteredListings = computed(() =>
  (data.value?.listings || []).filter((l: any) =>
    (showMatched.value || !l.cardId) && `${l.title} ${l.sku} ${l.variation}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
const orders = computed(() =>
  (data.value?.orders || []).filter((o: any) =>
    (showMatched.value || !o.cardId) && `${o.title} ${o.orderId} ${o.sku}`
      .toLowerCase()
      .includes(query.value.toLowerCase()),
  ),
);
const discrepancies = computed(() =>
  (data.value?.reconciliation || []).filter((r: any) => r.toAdd > 0),
);
const page = ref(1),
  pageCount = computed(() =>
    Math.max(
      1,
      Math.ceil(
        (view.value === "listings"
          ? filteredListings.value.length
          : orders.value.length) / 25,
      ),
    ),
  );
watch([view, query, showMatched], () => {
  page.value = 1;
});
watch(pageCount, (n) => {
  page.value = Math.min(page.value, n);
});
const pagedListings = computed(() =>
  filteredListings.value.slice((page.value - 1) * 25, page.value * 25),
);
const pagedOrders = computed(() =>
  orders.value.slice((page.value - 1) * 25, page.value * 25),
);
const cardSearch = reactive<Record<string, string>>({});
const normaliseSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
function cardChoices(key: string) {
  const words = normaliseSearch(cardSearch[key] || "").trim().split(/\s+/).filter(Boolean);
  return props.cards.filter((card) => {
    const text = normaliseSearch(`${card.player} ${card.club} ${card.number} ${card.variant} ${card.season} ${card.collection} ${card.condition}`);
    return words.every(word => text.includes(word.replace(/^#/, "")));
  });
}
async function act(action: string, extra: Record<string, any> = {}) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const result: any = await $fetch("/api/ebay/action", {
      method: "POST",
      body: { action, ...extra },
    });
    if (result.authorizationUrl) {
      window.location.assign(result.authorizationUrl);
      return;
    }
    data.value = result;
    emit("updated");
    notice.value =
      action === "sync"
        ? "eBay snapshot updated."
        : action === "reconcile"
          ? "eBay quantities added to your current stock. Previously imported listings were skipped."
          : "Saved.";
  } catch (e: any) {
    error.value =
      e.data?.statusMessage ||
      "Request failed. Refresh the status before retrying.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="ebay-panel">
    <div class="error-box" v-if="data?.accountDeleted">Your seller account was deleted. Its imported eBay records were removed and the connection was closed. Physical stock counts were preserved.</div>
    <div class="error-box" v-if="data?.notificationError" role="alert">{{ data.notificationError }}</div>
    <p v-if="data?.notificationOldest">Oldest pending notification: {{ data.notificationOldest }}</p>
    <p>Notification service: {{ data?.notificationLastCheck ? 'Last checked ' + new Date(data.notificationLastCheck).toLocaleString() : 'Waiting for setup' }} <Button :disabled="busy" @click="act('notifications')">Check notifications</Button></p>
    <p
      v-if="
        connectionOutcome === 'connection-failed' ||
        connectionOutcome === 'denied'
      "
      role="alert"
      class="error-box"
    >
      eBay connection was not completed. Check the production RuName and
      accepted redirect URL, then connect again.
    </p>
    <p
      v-else-if="connectionOutcome === 'connected'"
      role="status"
      class="ebay-notice"
    >
      Seller account connected. Sync your listings and orders to begin
      reconciliation.
    </p>
    <div v-if="error || loadError" role="alert" class="error-box">
      {{ error || "Could not load eBay settings." }}
      <button @click="refresh()">Refresh status</button>
    </div>
    <div v-if="notice" role="status" class="ebay-notice">{{ notice }}</div>
    <section class="panel ebay-section">
      <div class="ebay-heading">
        <div>
          <h2>eBay connection</h2>
          <p class="muted">
            {{
              data?.connected
                ? `Connected as ${data.seller}`
                : "Connect the seller account that holds your card listings."
            }}
          </p>
        </div>
        <Button
          :disabled="busy || !data?.configured || !data?.redirectConfigured"
          @click="act('connect')"
          >{{ data?.connected ? "Reconnect eBay" : "Connect eBay" }}</Button
        >
      </div>
      <p v-if="!data?.configured" class="error-box">
        Server credentials or encryption key are missing. See the eBay setup
        guide.
      </p>
      <details :open="!data?.redirectConfigured">
        <summary>Connection setup</summary>
        <p>
          Enter the production RuName from your eBay developer account. Its
          accepted redirect URL must reach this app’s
          <code>/api/ebay/callback</code> endpoint. The RuName is a name
          supplied by eBay, not the URL itself. Seller sign-in and consent are
          required.
        </p>
        <div class="ebay-inline">
          <label
            >Production RuName<input
              v-model="ruName"
              autocomplete="off"
              placeholder="Your eBay Redirect URL name"
              maxlength="300" /></label
          ><Button
            variant="outline"
            :disabled="busy || !ruName.trim()"
            @click="act('settings', { ruName })"
            >Save RuName</Button
          >
        </div>
        <p class="muted">
          Configure eBay’s approved HTTPS redirect to this deployment’s
          <code>/api/ebay/callback</code> route. Keep admin authentication enabled.
          See <code>docs/ebay.md</code> for the remaining
          connection step.
        </p>
      </details>
    </section>
    <section class="panel ebay-section">
      <div class="ebay-heading">
        <div>
          <h2>
            {{
              data?.autoSince
                ? "Automatic sales deductions enabled"
                : "Stocktake mode"
            }}
          </h2>
          <p class="muted">
            {{
              data?.autoSince
                ? `Applies eligible orders created after ${new Date(data.autoSince).toLocaleString("en-GB")}.`
                : "Sales are collected for review while you finish counting your cards."
            }}
          </p>
        </div>
        <Button
          variant="outline"
          :disabled="busy || !data?.connected || !data?.lastSync"
          @click="act('automatic', { enabled: !data?.autoSince })"
          >{{
            data?.autoSince
              ? "Pause deductions"
              : "Stocktake complete: enable deductions"
          }}</Button
        >
      </div>
      <p>
        Sync reads your eBay listings and orders; it does not change listings on
        eBay. It runs every 15 minutes while this app’s server is running. Only
        confirmed single-card matches can affect stock. Lots, full sets and
        multi-card bundles must be handled separately.
      </p>
      <div class="ebay-inline">
        <Button
          :disabled="busy || !data?.connected || data?.syncing"
          @click="act('sync')"
          >{{ busy ? "Working…" : "Sync eBay now" }}</Button
        ><span class="muted">{{
          data?.lastSync
            ? `Last successful sync: ${new Date(data.lastSync).toLocaleString("en-GB")}`
            : "No successful sync yet."
        }}</span>
      </div>
      <p v-if="data?.lastError" class="error-box" role="alert">
        {{ data.lastError }}
      </p>
    </section>
    <section class="panel ebay-section">
      <h2>Add eBay stock to your count</h2>
      <p>
        Add the available quantity of each matched listing to your current count.
        Each listing is added once, so repeating this action or syncing cannot add it twice.
        Added copies have £0 allocated cost. Later eBay quantity changes do not add more stock automatically.
      </p>
      <div class="table-scroll" v-if="discrepancies.length">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th>Counted stock</th>
              <th>To add from eBay</th><th>New stock total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in discrepancies" :key="row.cardId">
              <td>{{ cardName(row.cardId) }}</td>
              <td>{{ row.stock }}</td>
              <td>+{{ row.toAdd }}</td><td>{{ row.stock + row.toAdd }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted">No new matched eBay stock to add.</p>
      <Button
        variant="outline"
        :disabled="busy || !discrepancies.length"
        @click="act('reconcile')"
        >Add matched eBay stock</Button
      >
    </section>
    <section class="panel ebay-section">
      <div class="ebay-inline">
        <Button
          :variant="view === 'listings' ? 'default' : 'outline'"
          @click="view = 'listings'"
          >Listings ({{ filteredListings.length }})</Button
        ><Button
          :variant="view === 'orders' ? 'default' : 'outline'"
          @click="view = 'orders'"
          >Orders ({{ orders.length }})</Button
        ><input
          v-model="query"
          aria-label="Search eBay records"
          placeholder="Search title, SKU or order…"
        />
        <label><input v-model="showMatched" type="checkbox" /> Show matched entries</label>
      </div>
      <p class="muted">
        Confirm the card number, section, season and variant before linking.
        Mapping is per listing/SKU, never guessed from a player name. Confirm
        only listings that sell one copy of this exact card per unit.
      </p>
      <div v-if="view === 'listings'" class="ebay-records">
        <article v-for="listing in pagedListings" :key="listing.key">
          <div>
            <strong>{{ listing.title }}</strong
            ><small
              >{{ listing.itemId }} · {{ listing.sku || "No SKU" }} ·
              {{ listing.variation }}</small
            >
            <p>
              {{
                listing.active
                  ? `${listing.available} available on eBay`
                  : "Not present in latest active-listing snapshot"
              }}
              · {{ cardName(listing.cardId) }}
            </p>
          </div>
          <div v-if="!listing.cardId" class="ebay-inline">
            <label>
              Search catalogue cards
              <input v-model="cardSearch[listing.key]"
                :aria-label="`Search catalogue cards for ${listing.title}`"
                placeholder="Player, number, club or card type…"
                @input="delete mapping[listing.key]" />
              <small>{{ cardChoices(listing.key).length }} matching cards</small>
            </label>
            <select
              v-model="mapping[listing.key]"
              :aria-label="`Card for ${listing.title}`"
            >
              <option :value="undefined" disabled>
                Select exact catalogue card
              </option>
              <option
                v-for="card in cardChoices(listing.key)"
                :key="card.id"
                :value="card.id"
              >
                {{ cardName(card.id) }}
              </option></select
            ><Button
              variant="outline"
              :disabled="busy || !mapping[listing.key]"
              @click="
                act('map', { key: listing.key, cardId: mapping[listing.key] })
              "
              >Confirm single-card match</Button
            >
          </div>
        </article>
        <p v-if="!filteredListings.length" class="muted">
          No listings match this view. Enable “Show matched entries” to see cards already linked.
        </p>
      </div>
      <div v-else class="ebay-records">
        <article v-for="order in pagedOrders" :key="order.key">
          <strong>{{ order.title }}</strong
          ><small
            >{{ order.orderId }} ·
            {{ new Date(order.created).toLocaleString("en-GB") }} ·
            {{ order.quantity }} sold ·
            {{
              order.currency === "GBP"
                ? money(order.gross)
                : `${order.gross / 100} ${order.currency}`
            }}
            item subtotal</small
          >
          <p>
            {{ cardName(order.cardId) }} · {{ order.disposition }} ·
            {{
              order.cancelled
                ? "Cancellation/refund needs review"
                : order.paid
                  ? "Paid"
                  : "Not confirmed paid"
            }}
          </p>
          <p v-if="order.issue" class="error-box">{{ order.issue }}</p>
          <div v-if="!order.cardId" class="ebay-inline">
            <label>
              Search catalogue cards
              <input v-model="cardSearch[keyFor(order)]"
                :aria-label="`Search catalogue cards for ${order.title}`"
                placeholder="Player, number, club or card type…"
                @input="delete mapping[keyFor(order)]" />
              <small>{{ cardChoices(keyFor(order)).length }} matching cards</small>
            </label>
            <select
              v-model="mapping[keyFor(order)]"
              :aria-label="`Card for order ${order.orderId}`"
            >
              <option :value="undefined" disabled>
                Select exact catalogue card
              </option>
              <option
                v-for="card in cardChoices(keyFor(order))"
                :key="card.id"
                :value="card.id"
              >
                {{ cardName(card.id) }}
              </option></select
            ><Button
              variant="outline"
              :disabled="busy || !mapping[keyFor(order)]"
              @click="
                act('map', {
                  key: keyFor(order),
                  cardId: mapping[keyFor(order)],
                })
              "
              >Confirm single-card match</Button
            >
          </div>
          <div
            class="ebay-inline"
            v-if="
              order.disposition === 'review' ||
              (order.saleId && !order.feesConfirmed)
            "
          >
            <label
              >Total fees / net postage cost (£)<input
                type="number"
                min="0"
                step="0.01"
                :max="order.gross / 100"
                v-model.number="fees[order.key]"
                placeholder="Enter verified cost, including 0" /></label
            ><Button
              v-if="order.disposition === 'review'"
              :disabled="
                busy ||
                !order.cardId ||
                !order.paid ||
                order.cancelled ||
                order.currency !== 'GBP' ||
                fees[order.key] === undefined
              "
              @click="
                act('review', {
                  key: order.key,
                  mode: 'apply',
                  fees: Math.round(fees[order.key] * 100),
                })
              "
              >Record sale and deduct stock</Button
            ><Button
              v-else
              :disabled="busy || fees[order.key] === undefined"
              @click="
                act('review', {
                  key: order.key,
                  mode: 'fees',
                  fees: Math.round(fees[order.key] * 100),
                })
              "
              >Confirm fees</Button
            ><Button
              v-if="order.disposition === 'review'"
              variant="outline"
              :disabled="busy"
              @click="
                act('review', {
                  key: order.key,
                  mode: 'already-counted',
                  fees: 0,
                })
              "
              >Already reflected in my count</Button
            >
          </div>
          <p v-if="order.saleId && !order.feesConfirmed" class="muted">
            Fees are awaiting confirmation. Profit is provisional.
          </p>
        </article>
        <p v-if="!orders.length" class="muted">
          No imported orders. The first sync reads up to 89 days of available
          history.
        </p>
      </div>
      <div class="ebay-inline">
        <Button variant="outline" :disabled="page <= 1" @click="page--"
          >Previous</Button
        ><span>Page {{ page }} of {{ pageCount }}</span
        ><Button variant="outline" :disabled="page >= pageCount" @click="page++"
          >Next</Button
        >
      </div>
    </section>
  </div>
</template>
<style scoped>
.ebay-panel {
  display: grid;
  gap: 20px;
}
.ebay-section {
  padding: 23px;
}
.ebay-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}
.ebay-section p {
  font-size: 12px;
  line-height: 1.7;
  margin: 12px 0;
}
.ebay-section summary {
  cursor: pointer;
  padding: 12px 0;
}
.ebay-inline {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
  margin: 14px 0;
}
.ebay-inline input,
.ebay-inline select {
  max-width: 450px;
}
.ebay-inline label {
  max-width: 450px;
  flex: 1;
  min-width: 180px;
}
.ebay-records article {
  padding: 20px 0;
  border-top: 1px solid #e3e6eb;
}
.ebay-records small {
  display: block;
  color: #7b8493;
  margin-top: 7px;
}
.ebay-notice {
  padding: 14px;
  border-radius: 8px;
  background: #eaf5ed;
  color: #246b47;
}
.ebay-card-search {
  max-width: 550px;
  margin-top: 20px;
}
.table-scroll {
  overflow: auto;
}
code {
  overflow-wrap: anywhere;
}
</style>
