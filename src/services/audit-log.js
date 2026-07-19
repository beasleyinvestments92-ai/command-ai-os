import { query } from '../db/index.js';
import { id } from '../utils/ids.js';

export async function auditLog(req, action, entityType = null, entityId = null, data = {}) {
  await query(`INSERT INTO audit_logs(id, tenant_id, user_id, action, entity_type, entity_id, data, ip)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [
    id('audit'),
    req.auth?.tenant?.id || null,
    req.auth?.user?.id || null,
    action,
    entityType,
    entityId,
    JSON.stringify(data || {}),
    req.ip || null
  ]);
}
