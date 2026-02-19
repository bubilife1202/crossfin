<script setup>
defineProps({
  endpoints: {
    type: Array,
    required: true,
  },
})
</script>

<template>
  <div class="api-table-wrap">
    <table class="api-table">
      <thead>
        <tr>
          <th>Method</th>
          <th>Endpoint</th>
          <th>Description</th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(ep, i) in endpoints" :key="i">
          <td>
            <span
              class="method-badge"
              :class="'method-' + ep.method.toLowerCase()"
            >
              {{ ep.method }}
            </span>
          </td>
          <td><code class="endpoint-path">{{ ep.path }}</code></td>
          <td class="endpoint-desc">{{ ep.description }}</td>
          <td>
            <span
              class="price-badge"
              :class="ep.price === 'Free' ? 'price-free' : 'price-paid'"
            >
              {{ ep.price }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.api-table-wrap {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  margin: 16px 0 24px;
  border: 1px solid #2a2f3d;
  border-radius: 12px;
  background: #1a1d27;
}

.api-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.api-table thead th {
  text-align: left;
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #5f6a7d;
  padding: 12px 14px;
  border-bottom: 1px solid #2a2f3d;
  white-space: nowrap;
  background: transparent;
}

.api-table tbody td {
  padding: 11px 14px;
  border-bottom: 1px solid #222736;
  color: #8b95a5;
  vertical-align: middle;
}

.api-table tbody tr:last-child td {
  border-bottom: none;
}

.api-table tbody tr {
  transition: background 0.15s ease;
}

.api-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.02);
}

/* Method badges */
.method-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  font-family: var(--vp-font-family-mono);
  letter-spacing: 0.03em;
  min-width: 42px;
  text-align: center;
}

.method-get {
  color: #00f59a;
  background: rgba(0, 245, 154, 0.1);
}

.method-post {
  color: #5b8aff;
  background: rgba(91, 138, 255, 0.12);
}

.method-put {
  color: #ff9d42;
  background: rgba(255, 157, 66, 0.12);
}

.method-delete {
  color: #ff5c5c;
  background: rgba(255, 92, 92, 0.12);
}

/* Endpoint path */
.endpoint-path {
  font-size: 0.82rem;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.04) !important;
  border: 1px solid rgba(255, 255, 255, 0.04) !important;
  color: #c8ceda !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
}

.endpoint-desc {
  color: #8b95a5;
}

/* Price badges */
.price-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 0.78rem;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  white-space: nowrap;
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
  .api-table {
    font-size: 0.82rem;
  }

  .api-table thead th,
  .api-table tbody td {
    padding: 8px 10px;
  }
}
</style>
