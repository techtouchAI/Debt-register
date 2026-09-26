/**
 * نتيجة `webContents.print`.
 * الإلغاء على ويندوز يأتي غالباً بنجاح كاذب أو بسبب فارغ أو يحتوي cancel.
 * لا يُعدّ ذلك فشلاً يُعرض للمستخدم، ولا نجاح طباعة.
 */
function classifyPrintCallback(success, failureReason) {
  if (success) return { success: true, cancelled: false };
  const reason = typeof failureReason === 'string' ? failureReason.trim() : '';
  const cancelled = reason === '' || /cancel|abort/i.test(reason);
  if (cancelled) return { success: false, cancelled: true };
  return { success: false, cancelled: false, error: reason || 'تعذّرت الطباعة' };
}

module.exports = { classifyPrintCallback };
