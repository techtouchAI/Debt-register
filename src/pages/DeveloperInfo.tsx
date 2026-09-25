import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { ArrowUpLeft, Code2, ExternalLink, Play, Send } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { reportError } from '@/lib/errors';

const developerLinks = [
  {
    name: 'قناة يوتيوب',
    description: 'تابع الشروحات ومحتوى التطبيق على يوتيوب',
    action: 'زيارة القناة',
    href: 'https://youtube.com/@kinanmajeed?si=I2yuzJT2rRnEHLVg',
    icon: Play,
    accent: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
    hover: 'hover:border-red-200 dark:hover:border-red-500/40'
  },
  {
    name: 'تيليغرام',
    description: 'تواصل مع المطور عبر تيليغرام',
    action: 'فتح تيليغرام',
    href: 'https://t.me/techtouch7',
    icon: Send,
    accent: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400',
    hover: 'hover:border-sky-200 dark:hover:border-sky-500/40'
  }
];

export function DeveloperInfo() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
          <Code2 className="h-7 w-7 text-primary-600" aria-hidden="true" />
          معلومات المطور
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          قنوات التواصل الرسمية ومعلومات مطوّر التطبيق
        </p>
      </header>

      <Card className="overflow-hidden border-0 shadow-md">
        <div className="relative overflow-hidden bg-gradient-to-l from-primary-700 via-primary-600 to-emerald-600 px-6 py-8 text-white sm:px-8 sm:py-10">
          <div className="pointer-events-none absolute -left-10 -top-16 h-48 w-48 rounded-full border-[24px] border-white/10" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-20 right-1/3 h-48 w-48 rounded-full bg-white/5" aria-hidden="true" />
          <div className="relative flex items-center gap-5">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/15 shadow-lg backdrop-blur-sm sm:h-24 sm:w-24">
              <Code2 className="h-10 w-10 sm:h-12 sm:w-12" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium text-white/90">
                مطوّر التطبيق
              </span>
              <h2 className="mt-3 text-2xl font-bold sm:text-3xl">كنان مجيد</h2>
              <p className="mt-1 text-sm text-white/80">إدارة المكتب · تطبيق لإدارة الأعمال اليومية</p>
            </div>
          </div>
        </div>

        <CardContent className="space-y-5 p-5 sm:p-7">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">تابعنا وتواصل معنا</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              اختر القناة المناسبة لمتابعة المحتوى أو التواصل مع المطور.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {developerLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Card
                  key={link.name}
                  className={`group border border-gray-200 shadow-none transition duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 ${link.hover}`}
                >
                  <CardContent className="p-0">
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${link.action} — ${link.name} (يفتح في علامة تبويب جديدة)`}
                      onClick={(event) => {
                        if (!Capacitor.isNativePlatform()) return;
                        event.preventDefault();
                        void Browser.open({ url: link.href }).catch((error) =>
                          reportError('DeveloperInfo.openLink', error, 'تعذّر فتح الرابط الخارجي')
                        );
                      }}
                      className="flex min-h-28 items-center gap-4 rounded-xl p-4 outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 sm:p-5"
                    >
                      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${link.accent}`}>
                        <Icon className="h-6 w-6" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold text-gray-900 dark:text-white">{link.name}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                          {link.description}
                        </span>
                        <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 dark:text-primary-300">
                          {link.action}
                          <ArrowUpLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
                        </span>
                      </span>
                      <ExternalLink className="h-4 w-4 shrink-0 text-gray-400 transition-colors group-hover:text-primary-600 dark:group-hover:text-primary-400" aria-hidden="true" />
                    </a>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-2 rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-3 text-center text-sm font-medium text-primary-800 dark:border-primary-900/40 dark:bg-primary-950/30 dark:text-primary-200">
        <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
        شكراً لاستخدامك التطبيق
      </div>
    </div>
  );
}
