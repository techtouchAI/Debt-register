/**
 * حماية رموز الدخول (PIN) المخزنة محلياً.
 *
 * الرمز كان يُخزن كنص صريح ويظهر في واجهة الإعدادات، أي أن أي نسخة احتياطية
 * منسوخة على ذاكرة خارجية تكشفه. هنا نُخزّنه كبصمة SHA-256 مع ملح عشوائي
 * عندما يتوفر WebCrypto (سياق آمن)، مع الحفاظ على التوافق مع القيم القديمة.
 */

import { toLatinDigits } from './digits'

const PREFIX = 'sha256$'

/**
 * صيغة موحّدة للرمز قبل التحقق/التشفير: أرقام لاتينية بلا مسافات، فيطابق
 * "١٢٣٤" المكتوب بلوحة عربية الرمز "1234" نفسه في كل مكان.
 */
export function normalizePin(pin: string): string {
  return toLatinDigits(pin).trim()
}

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

function getRandomSalt(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return toHex(bytes.buffer)
}

function getSubtle(): SubtleCrypto | null {
  if (typeof crypto === 'undefined') return null
  return crypto.subtle ?? null
}

export function isHashedPin(value: string | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/** إرجاع تمثيل آمن للعرض — لا يُظهر الرمز أبداً. */
export function maskPin(): string {
  return '••••'
}

export async function hashPin(rawPin: string): Promise<string> {
  const pin = normalizePin(rawPin)
  const subtle = getSubtle()
  if (!subtle) {
    // بيئة غير آمنة (http على عنوان شبكة): لا يتوفر WebCrypto
    console.warn('WebCrypto غير متاح، سيُحفظ رمز الدخول بدون تشفير')
    return pin
  }
  const salt = getRandomSalt()
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  const digest = await subtle.digest('SHA-256', data)
  return `${PREFIX}${salt}$${toHex(digest)}`
}

export async function verifyPin(rawPin: string, stored: string): Promise<boolean> {
  const pin = normalizePin(rawPin)
  if (!isHashedPin(stored)) return stored === pin
  const [, salt, expected] = stored.split('$')
  if (!salt || !expected) return false
  const subtle = getSubtle()
  if (!subtle) return false
  const data = new TextEncoder().encode(`${salt}:${pin}`)
  const digest = await subtle.digest('SHA-256', data)
  return toHex(digest) === expected
}

/** رمز دخول صالح: 4 إلى 8 أرقام. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(normalizePin(pin))
}
