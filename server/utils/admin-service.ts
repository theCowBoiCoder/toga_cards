import { createHash, timingSafeEqual } from "node:crypto";

export function validAdminServiceKey(
  supplied: string | undefined,
  expected = process.env.ADMIN_SERVICE_KEY,
): boolean {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected) || !supplied) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(supplied), digest(expected));
}
