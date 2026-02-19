<script setup>
defineProps({
  tools: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <div class="tool-grid">
    <div v-for="(tool, i) in tools" :key="i" class="tool-card">
      <code class="tool-name">{{ tool.name }}</code>
      <div class="tool-desc">{{ tool.description }}</div>
      <span
        class="tool-price"
        :class="tool.price.toLowerCase() === 'free' ? 'price-free' : 'price-paid'"
      >
        {{ tool.price }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 16px 0 24px;
}

.tool-card {
  padding: 16px 18px;
  background: #161921;
  border: 1px solid #222736;
  border-radius: 10px;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.tool-card:hover {
  border-color: #2a2f3d;
  background: #1a1d27;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.tool-name {
  font-size: 0.88rem;
  color: #e8eaed !important;
  background: none !important;
  border: none !important;
  padding: 0 !important;
  font-weight: 500;
  font-family: var(--vp-font-family-mono);
}

.tool-desc {
  font-size: 0.82rem;
  color: #5f6a7d;
  margin-top: 4px;
  line-height: 1.4;
}

.tool-price {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 600;
  margin-top: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
}

.price-free {
  color: #00f59a;
  background: rgba(0, 245, 154, 0.1);
}

.price-paid {
  color: #ffd866;
  background: rgba(255, 216, 102, 0.1);
}

@media (max-width: 720px) {
  .tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
