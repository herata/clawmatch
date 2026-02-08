export type DonationRow = {
  id: string
  match_id: string | null
  conversation_id: string | null
  amount_minor: number | null
  currency: string | null
  network: string | null
  status: 'initiated' | 'pending' | 'confirmed' | 'failed'
  payer_ref: string | null
  settlement_ref: string | null
  created_at: string
  confirmed_at: string | null
}

export const createDonation = async (
  db: D1Database,
  payload: {
    id: string
    matchId: string | null
    conversationId: string | null
    amountMinor: number | null
    currency: string | null
    network: string | null
    payerRef: string | null
    status: DonationRow['status']
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO donations
        (id, match_id, conversation_id, amount_minor, currency, network, status, payer_ref)
       VALUES
        (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    )
    .bind(
      payload.id,
      payload.matchId,
      payload.conversationId,
      payload.amountMinor,
      payload.currency,
      payload.network,
      payload.status,
      payload.payerRef
    )
    .run()
}

export const getDonationById = async (db: D1Database, id: string): Promise<DonationRow | null> => {
  return (
    (await db
      .prepare(
        `SELECT
           id,
           match_id,
           conversation_id,
           amount_minor,
           currency,
           network,
           status,
           payer_ref,
           settlement_ref,
           created_at,
           confirmed_at
         FROM donations
         WHERE id = ?1`
      )
      .bind(id)
      .first<DonationRow>()) ?? null
  )
}

export const updateDonationStatus = async (
  db: D1Database,
  payload: {
    id: string
    status: DonationRow['status']
    settlementRef?: string | null
    confirmedAt?: string | null
  }
): Promise<void> => {
  await db
    .prepare(
      `UPDATE donations
       SET
         status = ?2,
         settlement_ref = COALESCE(?3, settlement_ref),
         confirmed_at = COALESCE(?4, confirmed_at)
       WHERE id = ?1`
    )
    .bind(payload.id, payload.status, payload.settlementRef ?? null, payload.confirmedAt ?? null)
    .run()
}

export const createDonationEvent = async (
  db: D1Database,
  payload: {
    id: string
    donationId: string | null
    providerEventId: string
    payloadJson: string
  }
): Promise<{ inserted: boolean }> => {
  try {
    await db
      .prepare(
        `INSERT INTO donation_events (id, donation_id, provider_event_id, payload_json)
         VALUES (?1, ?2, ?3, ?4)`
      )
      .bind(payload.id, payload.donationId, payload.providerEventId, payload.payloadJson)
      .run()
    return { inserted: true }
  } catch (error) {
    const message = String(error)
    if (message.includes('UNIQUE') || message.includes('constraint')) {
      return { inserted: false }
    }
    throw error
  }
}

export const totalConfirmedDonationsByConversation = async (
  db: D1Database,
  conversationId: string
): Promise<number> => {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_minor), 0) AS total
       FROM donations
       WHERE conversation_id = ?1 AND status = 'confirmed'`
    )
    .bind(conversationId)
    .first<{ total: number }>()

  return Number(row?.total ?? 0)
}
