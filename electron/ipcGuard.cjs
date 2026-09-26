/**
 * مقارنة مسار file:// دون حساسية لحالة أحرف قرص ويندوز.
 * Chromium قد يُرجع `c:` بينما pathToFileURL يُبقي `C:`، ورفض IPC حينها
 * يعطّل الحفظ والطباعة رغم أن الصفحة هي التطبيق نفسه.
 */
function normalizeFilePathname(pathname, platform = process.platform) {
  let value = decodeURIComponent(String(pathname || '')).replace(/\\/g, '/');
  if (platform === 'win32') value = value.toLowerCase();
  return value;
}

function isSameFilePathname(left, right, platform = process.platform) {
  return normalizeFilePathname(left, platform) === normalizeFilePathname(right, platform);
}

module.exports = { normalizeFilePathname, isSameFilePathname };
