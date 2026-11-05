<script setup lang="ts">
const props = defineProps<{ card: any; index?: number }>();
const tone = computed(
  () =>
    ["#a62d29", "#286b92", "#e2b938", "#31765a", "#563b7b"][
      (props.index || 0) % 5
    ],
);
</script>
<template>
  <div class="card-art" :style="{ '--card-tone': tone }">
    <img
      v-if="card.photo"
      :src="card.photo"
      :alt="`${card.player} ${card.variant} card`"
      loading="lazy"
    />
    <div v-else class="card-sample">
      <div class="card-mast">
        <b>TOGA</b><span>{{ card.season }}</span>
      </div>
      <div class="card-stripes"></div>
      <span class="card-number">#{{ card.number }}</span>
      <div class="card-player">
        <small>{{ card.club }}</small
        ><strong>{{ card.player }}</strong
        ><span>{{ card.variant }}</span>
      </div>
      <div class="card-label">CATALOGUE PREVIEW · PHOTO COMING SOON</div>
    </div>
  </div>
</template>
<style scoped>
.card-art {
  aspect-ratio: 0.715;
  overflow: hidden;
  background: var(--card-tone);
  border-radius: 4px;
  color: white;
  position: relative;
  box-shadow: 0 12px 22px #18292220;
}
.card-art img {
  height: 100%;
  width: 100%;
  object-fit: contain;
  background: #eee;
}
.card-sample {
  height: 100%;
  position: relative;
  border: 8px solid #ffffffe6;
  overflow: hidden;
  background: linear-gradient(150deg, transparent, #0008), var(--card-tone);
}
.card-mast {
  display: flex;
  justify-content: space-between;
  padding: 12px;
  font-size: 11px;
  letter-spacing: 1px;
}
.card-mast b {
  font-style: italic;
  font-size: 18px;
}
.card-stripes {
  position: absolute;
  inset: 20% -70%;
  transform: rotate(-36deg);
  background: repeating-linear-gradient(
    90deg,
    transparent 0 25px,
    #ffffff18 25px 50px
  );
}
.card-number {
  position: absolute;
  top: 29%;
  left: 8%;
  font-size: clamp(32px, 5vw, 65px);
  font-weight: 900;
  opacity: 0.6;
  letter-spacing: -4px;
}
.card-player {
  position: absolute;
  bottom: 12%;
  left: 8%;
  right: 5%;
  display: grid;
  gap: 7px;
}
.card-player small {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
.card-player strong {
  font-size: clamp(16px, 2vw, 26px);
  line-height: 1.05;
  text-transform: uppercase;
  font-weight: 900;
  letter-spacing: -1px;
}
.card-player span {
  font-size: 10px;
}
.card-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: #ffffffde;
  color: #222;
  font-size: 6px;
  letter-spacing: 0.5px;
  text-align: center;
  padding: 6px 0;
}
</style>
