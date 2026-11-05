<script setup lang="ts">
const { data, refresh } = await useFetch<any>("/api/admin/shop");
const search = ref(""),
  message = ref(""),
  busy = ref(false);
const form = reactive({
  cardId: 0,
  price: 99,
  quantity: 0,
  photo: "",
  condition: "Not assessed",
  stockConfirmed: false,
});
const matches = computed(() =>
  (data.value?.products || [])
    .filter((c: any) =>
      `${c.player} ${c.number} ${c.variant}`
        .toLowerCase()
        .includes(search.value.toLowerCase()),
    )
    .slice(0, 30),
);
function select() {
  const c = data.value?.products.find((c: any) => c.id === Number(form.cardId));
  form.price = c?.price || 99;
  form.quantity =
    data.value?.stockSync?.targets.find(
      (t: any) => t.card_id === Number(form.cardId),
    )?.quantity ??
    data.value?.listings.find((l: any) => l.card_id === Number(form.cardId))
      ?.quantity ??
    0;
  form.photo = c?.photo || "";
  form.condition = c?.condition || "Not assessed";
  form.stockConfirmed = false;
}
async function save() {
  busy.value = true;
  message.value = "";
  try {
    const result = await $fetch<any>("/api/admin/shop", {
      method: "POST",
      body: form,
    });
    message.value = result.pendingSync
      ? "Saved. Website stock will be released after eBay verification and any mapping issues are resolved."
      : "Website listing saved.";
    await refresh();
  } catch (e: any) {
    message.value = e.data?.statusMessage || "Could not save.";
  } finally {
    busy.value = false;
  }
}
async function reconcile(id: string) {
  busy.value = true;
  try {
    const r = await $fetch<any>("/api/admin/reconcile", {
      method: "POST",
      body: { orderId: id },
    });
    message.value = `Order status: ${r.status}`;
    await refresh();
  } catch (e: any) {
    message.value = e.data?.statusMessage || "Could not reconcile.";
  } finally {
    busy.value = false;
  }
}
async function stockAction(action: string) {
  busy.value = true;
  try {
    await $fetch("/api/admin/stock-sync", { method: "POST", body: { action } });
    message.value =
      action === "pause"
        ? "Stock sync paused; website purchasing is paused."
        : "Stock sync queued. Progress updates below.";
    await refresh();
  } catch (e: any) {
    message.value = e.data?.statusMessage || "Stock sync could not start.";
  } finally {
    busy.value = false;
  }
}
let refreshTimer: ReturnType<typeof setInterval>;
onMounted(() => {
  refreshTimer = setInterval(() => {
    if (!busy.value) void refresh();
  }, 10000);
});
onUnmounted(() => clearInterval(refreshTimer));
const syncProblems = computed(() =>
  (data.value?.stockSync?.jobs || []).filter(
    (j: any) => j.status !== "verified",
  ),
);
</script>
<template>
  <section class="shop-admin panel">
    <header>
      <div>
        <h2>Website shop</h2>
        <p>One inventory ledger · Separate channel allocations</p>
      </div>
      <NuxtLink to="/shop">View storefront ↗</NuxtLink>
    </header>
    <p>
      Website copies are reserved separately from eBay copies. Automatic sync
      reduces eBay availability and verifies the change before releasing new
      website stock. Uncertain orders and unmapped listings prevent website
      publication.
    </p>
    <section class="sync-status">
      <h3>Automatic stock synchronisation</h3>
      <p>
        {{
          data?.stockSync?.enabled
            ? "Enabled · checks every two minutes and after stock changes"
            : data?.stockSync?.paused
              ? "Paused · website purchasing paused"
              : "Not enabled"
        }}{{ data?.stockSync?.running ? " · Running now" : "" }}
      </p>
      <p v-if="data?.stockSync?.lastSuccess">
        Last completed check: {{ data.stockSync.lastSuccess }} ·
        {{
          data.stockSync.jobs.filter((j: any) => j.status === "verified").length
        }}
        verified cards
      </p>
      <p v-if="data?.stockSync?.unmapped">
        <strong
          >{{ data.stockSync.unmapped }} active eBay listings need
          matching.</strong
        >
        New website stock stays unavailable until every active listing has an
        inventory match. <a href="/admin?ebay=review">Review eBay mappings ↗</a>
      </p>
      <p v-if="data?.stockSync?.lastError" role="alert">
        {{ data.stockSync.lastError }}
      </p>
      <p>
        Quantities are never automatically increased to fill a discrepancy.
        Count and review additional stock before relisting it.
      </p>
      <div class="sync-buttons">
        <button
          v-if="!data?.stockSync?.enabled"
          :disabled="busy"
          @click="stockAction('enable')"
        >
          Enable automatic stock sync</button
        ><template v-else
          ><button
            :disabled="busy || data.stockSync.running"
            @click="stockAction('sync')"
          >
            Check stock now</button
          ><button :disabled="busy" @click="stockAction('pause')">
            Pause sync and website purchasing
          </button></template
        >
      </div>
      <details v-if="syncProblems.length">
        <summary>
          {{ syncProblems.length }} cards pending or needing review
        </summary>
        <ul>
          <li v-for="j in syncProblems" :key="j.card_id">
            <strong>#{{ j.number }} {{ j.player }} · {{ j.variant }}</strong
            >: {{ j.error || j.status }}
          </li>
        </ul>
      </details>
    </section>
    <form @submit.prevent="save">
      <label
        >Find a card<input
          v-model="search"
          placeholder="Player or card number" /></label
      ><label
        >Card<select v-model.number="form.cardId" required @change="select">
          <option :value="0" disabled>Select a card</option>
          <option v-for="c in matches" :key="c.id" :value="c.id">
            #{{ c.number }} {{ c.player }} · {{ c.variant }}
          </option>
        </select></label
      ><label
        >Price (pence)<input
          v-model.number="form.price"
          type="number"
          min="50"
          required /></label
      ><label
        >Requested website allocation (including checkout holds)<input
          v-model.number="form.quantity"
          type="number"
          min="0"
          required /></label
      ><label
        >Assessed condition<select v-model="form.condition">
          <option>Not assessed</option>
          <option>Near mint</option>
          <option>Excellent</option>
          <option>Very good</option>
          <option>Good</option>
          <option>Poor</option>
        </select></label
      ><label
        >Product photo HTTPS URL<input
          v-model="form.photo"
          type="url"
          placeholder="https://…" /></label
      ><label class="allocation-confirm"
        ><input v-model="form.stockConfirmed" type="checkbox" />I have checked
        physical stock and condition; these copies can be reserved for website
        buyers after eBay verification.</label
      ><button :disabled="busy || !form.cardId" type="submit">
        {{ busy ? "Saving…" : "Save website listing" }}
      </button>
    </form>
    <p role="status">{{ message }}</p>
    <h3>Recent website orders</h3>
    <p>
      Payment fees and postage are not yet allocated to the inventory profit
      report. Stripe refunds require manual stock/accounting review.
    </p>
    <div class="orders-scroll">
      <table>
        <thead>
          <tr>
            <th>Created</th>
            <th>Reference</th>
            <th>Status</th>
            <th>Order total</th>
            <th>Reconcile</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in data?.orders" :key="o.id">
            <td>{{ o.created.slice(0, 16) }}</td>
            <td>{{ o.id }}</td>
            <td>{{ o.status }}</td>
            <td>£{{ (o.total / 100).toFixed(2) }}</td>
            <td>
              <button
                v-if="o.status === 'pending'"
                :disabled="busy"
                @click="reconcile(o.id)"
              >
                Check Stripe
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="!data?.orders?.length">No website orders yet.</p>
  </section>
</template>
<style scoped>
.shop-admin {
  padding: 24px;
  margin: 24px auto;
  max-width: 1400px;
}
.shop-admin header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
}
.shop-admin h2 {
  font-size: 22px;
  font-weight: 700;
}
.shop-admin p {
  color: #6b7280;
  font-size: 12px;
  margin: 12px 0;
  line-height: 1.7;
}
.shop-admin form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 15px;
}
.shop-admin .allocation-confirm {
  grid-column: 1/-1;
  display: flex;
  align-items: center;
  gap: 10px;
}
.allocation-confirm input {
  width: auto;
}
.shop-admin button {
  background: #166c52;
  border: 0;
  color: white;
  padding: 12px;
  border-radius: 6px;
}
.shop-admin h3 {
  font-weight: 700;
  margin-top: 24px;
}
.orders-scroll {
  overflow-x: auto;
}
.shop-admin th,
.shop-admin td {
  padding: 10px;
  text-align: left;
  font-size: 12px;
}
.shop-admin th {
  background: #f5f5f5;
}
@media (max-width: 640px) {
  .shop-admin form {
    grid-template-columns: 1fr;
  }
}
</style>

<style scoped>
.sync-status {
  background: #f4f6f0;
  border: 1px solid #dce3d4;
  padding: 18px;
  margin: 20px 0;
}
.sync-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.sync-status details {
  margin-top: 16px;
  font-size: 12px;
}
.sync-status li {
  margin: 10px 0;
}
.sync-status a {
  text-decoration: underline;
}
</style>
