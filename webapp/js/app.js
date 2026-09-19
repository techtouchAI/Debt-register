const features = [
  ['الفواتير والمبيعات', 'بيع نقدي وآجل وطباعة الفواتير'],
  ['المخزن', 'متابعة الكميات وتنبيهات النفاذ'],
  ['الزبائن والديون', 'كشف الحساب والتسديدات'],
  ['التقارير', 'الصندوق والمبيعات والأرباح'],
  ['النسخ الاحتياطي', 'بيانات محلية قابلة للتصدير والاستعادة'],
  ['خصوصية كاملة', 'لا خادم ولا اتصال خارجي']
];
document.querySelector('#features').innerHTML = features.map(([title, text]) => `<article class="card"><b>${title}</b><span>${text}</span></article>`).join('');
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
