<script setup>
defineProps({
  items: {
    type: Array,
    default: () => [],
  },
})
</script>

<template>
  <div class="steps-container">
    <div v-for="(item, i) in items" :key="i" class="step-card">
      <div class="step-number">{{ i + 1 }}</div>
      <div class="step-content">
        <div class="step-title">{{ item.title }}</div>
        <div v-if="item.description" class="step-desc">{{ item.description }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.steps-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0 24px;
}

.step-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px 20px;
  background: #1a1d27;
  border: 1px solid #2a2f3d;
  border-left: 3px solid #2a2f3d;
  border-radius: 12px;
  transition: all 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.step-card:hover {
  border-left-color: #00d4ff;
  background: #1f2230;
}

.step-number {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(0, 212, 255, 0.12);
  border: 1px solid rgba(0, 212, 255, 0.25);
  color: #00d4ff;
  font-size: 0.82rem;
  font-weight: 700;
  font-family: var(--vp-font-family-mono);
}

.step-content {
  flex: 1;
  min-width: 0;
}

.step-title {
  font-weight: 600;
  color: #e8eaed;
  font-size: 0.95rem;
}

.step-desc {
  margin-top: 4px;
  font-size: 0.85rem;
  color: #5f6a7d;
  line-height: 1.5;
}
</style>
