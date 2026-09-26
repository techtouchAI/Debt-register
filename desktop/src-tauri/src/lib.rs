/// آخر حالة أرسلها سكربت الدخان في الواجهة عبر أمر `smoke_report`.
/// فارغة = الواجهة لم تنفّذ أي جافاسكربت بعد (مشكلة على مستوى WebView نفسه).
static SMOKE_REPORT: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// أمر تشخيصي لاختبار الدخان: تستدعيه الواجهة لتبليغ حالة الإقلاع مباشرة
/// إلى العملية الأصلية — قناة أقوى من مزامنة عنوان النافذة (document.title)
/// التي قد تتأخر أو تتعطل في بعض بيئات التشغيل (مثل عدّاءات CI).
/// غير مقيّد بسطح المكتب حتى يُصرف في كل الأهداف بلا أخطاء ترجمة.
#[tauri::command]
fn smoke_report(state: String) {
    if let Ok(mut guard) = SMOKE_REPORT.lock() {
        *guard = state;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // نسخة واحدة فقط من التطبيق على سطح المكتب: نافذتان على نفس قاعدة
    // البيانات المحلية تعني كتابة متضاربة على الفواتير والديون.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    // fs قبل dialog: صندوق الحفظ يضيف المسار الذي يختاره المستخدم إلى نطاق
    // الكتابة المسموح في إضافة fs (لا صلاحية كتابة عامة على القرص).
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![smoke_report])
        .setup(|app| {
            #[cfg(desktop)]
            if std::env::args().any(|arg| arg == "--smoke-test") {
                let handle = app.handle().clone();
                std::thread::spawn(move || tauri_smoke(handle));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the office manager application");
}

/// يثبت أن الواجهة رُسمت وأن قناة IPC ليست محجوبة، ثم يخرج برمز واضح.
/// لا يفتح صندوق حفظ ولا يرسل إشعاراً.
#[cfg(desktop)]
fn tauri_smoke(handle: tauri::AppHandle) {
    use tauri::Manager;
    // يفحص السكربت بوابات الإقلاع بالترتيب ويبلّغ أول بوابة عالقة عبر أمر
    // `smoke_report` (ويحدّث عنوان المستند أيضاً كمسار احتياطي):
    //   no-root      = صفحة بلا عنصر جذر (الواجهة المدمجة لم تُحمَّل أصلاً)
    //   empty-root   = React لم يرسم شيئاً (يُرفق حالة إقلاع التطبيق appBoot)
    //   db=<n>       = قاعدة البيانات المحلية غير متاحة (n=-1 إن رُفض الاستعلام)
    //   ipc:<خطأ>    = قناة الأوامر الأصلية محجوبة أو معطلة
    //   READY        = كل البوابات سليمة
    const SMOKE_JS: &str = r#"
(() => {
  const boot = () => {
    try { return document.documentElement.dataset.appBoot || '?'; } catch (e) { return '?'; }
  };
  const report = async (state) => {
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        await window.__TAURI_INTERNALS__.invoke('smoke_report', { state });
      }
    } catch (e) {}
    document.title = state === 'READY' ? 'SMOKE_READY' : ('SMOKE_WAIT:' + state.slice(0, 80));
  };
  const mark = async () => {
    const root = document.getElementById('root');
    if (!root) { await report('no-root boot=' + boot()); return; }
    if (root.childElementCount === 0) { await report('empty-root boot=' + boot()); return; }
    let dbCount = 0;
    try { dbCount = (await indexedDB.databases()).length; } catch (e) { dbCount = -1; }
    if (dbCount <= 0) { await report('db=' + dbCount + ' boot=' + boot()); return; }
    let ipc = 'missing';
    try {
      if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
        await window.__TAURI_INTERNALS__.invoke('plugin:path|join', { paths: ['a', 'b'] });
        ipc = 'ok';
      }
    } catch (error) {
      const message = String((error && error.message) || error);
      ipc = /fetch|network|blocked|content security|IPC custom/i.test(message) ? message : 'ok';
    }
    if (ipc === 'ok') { await report('READY'); } else { await report('ipc:' + String(ipc).slice(0, 60)); }
  };
  mark();
})()"#;
    let started = std::time::Instant::now();
    let log_path = std::env::temp_dir().join("office-manager-smoke.txt");
    let mut last = String::from("starting");
    loop {
        let reported = SMOKE_REPORT
            .lock()
            .map(|guard| (*guard).clone())
            .unwrap_or_default();
        if started.elapsed() > std::time::Duration::from_secs(60) {
            let _ = std::fs::write(&log_path, format!("{last} | js={reported}"));
            handle.exit(1);
            return;
        }
        if let Some(window) = handle.get_webview_window("main") {
            let url = window.url().map(|value| value.to_string()).unwrap_or_default();
            let _ = window.eval(SMOKE_JS);
            std::thread::sleep(std::time::Duration::from_millis(600));
            let title = window.title().unwrap_or_default();
            let reported = SMOKE_REPORT
                .lock()
                .map(|guard| (*guard).clone())
                .unwrap_or_default();
            last = format!("{url} | {title}");
            let host_ok = url.contains("tauri.localhost")
                || url.contains("asset.localhost")
                || url.starts_with("tauri://")
                || url.starts_with("asset://");
            // النجاح عبر أيٍّ من القناتين: تبليغ الأمر الأصلي (الأقوى) أو
            // عنوان النافذة (المسار التاريخي).
            if host_ok && (reported == "READY" || title == "SMOKE_READY") {
                let _ = std::fs::write(&log_path, format!("{last} | js={reported}"));
                handle.exit(0);
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
}
