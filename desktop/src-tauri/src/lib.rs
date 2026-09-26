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
    const SMOKE_JS: &str = r#"
(() => {
  const mark = async () => {
    const root = document.getElementById('root');
    if (!root || root.childElementCount === 0) return;
    let dbCount = 0;
    try { dbCount = (await indexedDB.databases()).length; } catch (e) { dbCount = 0; }
    if (!dbCount) return;
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
    document.title = ipc === 'ok' ? 'SMOKE_READY' : ('SMOKE_WAIT:' + ipc.slice(0, 80));
  };
  mark();
})()
"#;
    let started = std::time::Instant::now();
    let log_path = std::env::temp_dir().join("office-manager-smoke.txt");
    let mut last = String::from("starting");
    loop {
        if started.elapsed() > std::time::Duration::from_secs(60) {
            let _ = std::fs::write(&log_path, &last);
            handle.exit(1);
            return;
        }
        if let Some(window) = handle.get_webview_window("main") {
            let url = window.url().map(|value| value.to_string()).unwrap_or_default();
            let _ = window.eval(SMOKE_JS);
            std::thread::sleep(std::time::Duration::from_millis(600));
            let title = window.title().unwrap_or_default();
            last = format!("{url} | {title}");
            let host_ok = url.contains("tauri.localhost")
                || url.contains("asset.localhost")
                || url.starts_with("tauri://")
                || url.starts_with("asset://");
            if title == "SMOKE_READY" && host_ok {
                let _ = std::fs::write(&log_path, &last);
                handle.exit(0);
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(400));
    }
}
