/**
 * Error monitoring module for CrossFin API.
 *
 * Provides error recording, error-rate alerting via Telegram,
 * and an endpoint-health summary query for admin dashboards.
 */

// ---------------------------------------------------------------------------
// recordError — persist a single error event
// ---------------------------------------------------------------------------

export async function recordError(
  db: D1Database,
  endpoint: string,
  statusCode: number,
  message: string,
  source: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO error_events (id, endpoint, status_code, error_message, source, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
    )
    .bind(crypto.randomUUID(), endpoint, statusCode, message.slice(0, 500), source)
    .run()
}

// ---------------------------------------------------------------------------
// checkErrorRateAndAlert — check recent error rate, alert via Telegram
// ---------------------------------------------------------------------------

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    },
  )
  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(
      `telegram_send_message_failed:${response.status} ${details.slice(0, 180)}`,
    )
  }
}

export async function checkErrorRateAndAlert(
  db: D1Database,
  telegramToken: string,
  adminChatId: string,
  thresholdPct: number,
): Promise<{ alerted: boolean; errorRate: number }> {
  // Count total and error calls in the last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const total = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM endpoint_calls WHERE created_at >= ?",
    )
    .bind(fiveMinAgo)
    .first<{ cnt: number }>()

  const errors = await db
    .prepare(
      "SELECT COUNT(*) as cnt FROM error_events WHERE created_at >= ?",
    )
    .bind(fiveMinAgo)
    .first<{ cnt: number }>()

  const totalCount = Number(total?.cnt ?? 0)
  const errorCount = Number(errors?.cnt ?? 0)

  if (totalCount === 0) {
    return { alerted: false, errorRate: 0 }
  }

  const errorRate = (errorCount / totalCount) * 100

  if (errorRate > thresholdPct) {
    const msg = [
      '⚠️ CrossFin Error Rate Alert',
      `Error rate: ${errorRate.toFixed(1)}% (threshold: ${thresholdPct}%)`,
      `Errors: ${errorCount} / ${totalCount} calls (last 5 min)`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n')

    try {
      await sendTelegramMessage(telegramToken, adminChatId, msg)
      return { alerted: true, errorRate }
    } catch {
      // If telegram itself fails, still return the rate
      return { alerted: false, errorRate }
    }
  }

  return { alerted: false, errorRate }
}

// ---------------------------------------------------------------------------
// getEndpointHealth — aggregate health summary for admin dashboard
// ---------------------------------------------------------------------------

export async function getEndpointHealth(
  db: D1Database,
  hours?: number,
): Promise<
  Array<{
    endpoint: string
    totalCalls: number
    errorCount: number
    errorRate: number
    avgLatencyMs: number
  }>
> {
  const lookbackHours = hours ?? 1
  const since = new Date(
    Date.now() - lookbackHours * 60 * 60 * 1000,
  ).toISOString()

  // Aggregate from endpoint_calls (the existing telemetry table)
  const calls = await db
    .prepare(
      `SELECT
         path as endpoint,
         COUNT(*) as total_calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
         AVG(response_time_ms) as avg_latency_ms
       FROM endpoint_calls
       WHERE created_at >= ?
       GROUP BY path
       ORDER BY error_count DESC`,
    )
    .bind(since)
    .all<{
      endpoint: string
      total_calls: number
      error_count: number
      avg_latency_ms: number
    }>()

  return (calls.results ?? []).map((row) => {
    const totalCalls = Number(row.total_calls)
    const errorCount = Number(row.error_count)
    return {
      endpoint: row.endpoint,
      totalCalls,
      errorCount,
      errorRate: totalCalls > 0 ? Math.round((errorCount / totalCalls) * 10000) / 100 : 0,
      avgLatencyMs: Math.round(Number(row.avg_latency_ms ?? 0)),
    }
  })
}
