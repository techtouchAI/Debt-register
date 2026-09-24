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
        .run(tauri::generate_context!())
        .expect("error while running the office manager application");
}
