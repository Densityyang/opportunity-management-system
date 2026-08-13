const MAINLAND_MOBILE_PATTERN = /^1[3-9]\d{9}$/;

export function initialPasswordFromPhone(phone: string): string {
  const normalized = phone.trim();
  if (!MAINLAND_MOBILE_PATTERN.test(normalized))
    throw new Error("手机号格式无效，无法生成初始密码");
  return normalized.slice(-6);
}
