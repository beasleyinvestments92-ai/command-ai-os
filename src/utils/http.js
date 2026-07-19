export class HttpError extends Error {
  constructor(status, message, details = undefined, code = undefined) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requireFields(object, fields) {
  const missing = fields.filter((field) => object[field] === undefined || object[field] === null || object[field] === '');
  if (missing.length) throw new HttpError(400, `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
}
