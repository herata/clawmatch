export const insertAuditLog = async (
  db: D1Database,
  payload: {
    actorProvider: string
    actorSubject: string
    action: string
    targetType?: string
    targetId?: string
    metaJson?: string
  }
): Promise<void> => {
  await db
    .prepare(
      `INSERT INTO audit_logs
        (id, actor_provider, actor_subject, action, target_type, target_id, meta_json)
       VALUES
        (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    )
    .bind(
      crypto.randomUUID(),
      payload.actorProvider,
      payload.actorSubject,
      payload.action,
      payload.targetType ?? null,
      payload.targetId ?? null,
      payload.metaJson ?? null
    )
    .run()
}
