export function statement(db: D1Database, sql: string, ...values: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...values);
}
export async function rows<T>(db: D1Database, sql: string, ...values: unknown[]): Promise<T[]> {
  return (await statement(db, sql, ...values).all<T>()).results;
}
export function one<T>(db: D1Database, sql: string, ...values: unknown[]): Promise<T | null> {
  return statement(db, sql, ...values).first<T>();
}
export function uid(): string {
  return crypto.randomUUID();
}
export function now(): number {
  return Date.now();
}
