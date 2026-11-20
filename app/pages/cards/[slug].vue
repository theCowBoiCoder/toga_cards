<script setup lang="ts">
import { productPath } from "#shared/seo";
const route = useRoute();
const slug = String(route.params.slug);
const id = /^([1-9]\d*)-/.exec(slug)?.[1];
if (!id) throw createError({ statusCode: 404, statusMessage: "Card not found" });
const { data: card, error } = await useFetch(`/api/shop/products/${id}`);
if (error.value || !card.value) throw createError({ statusCode: error.value?.statusCode || 404, statusMessage: "Card not found" });
if (route.path !== productPath(card.value)) await navigateTo(productPath(card.value), { redirectCode: 301 });
</script>
<template><Storefront :key="String(route.params.slug)" :product="card!" shop-page /></template>
