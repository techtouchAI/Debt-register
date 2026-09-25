import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import App from '@/App';
import { seedOfficeProfile } from './helpers';

vi.mock('@capacitor/browser', () => ({
  Browser: { open: vi.fn().mockResolvedValue(undefined) }
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('صفحة معلومات المطور', () => {
  it('تظهر بعد الإعدادات في القائمة وتعرض قنوات التواصل الصحيحة', async () => {
    await seedOfficeProfile();
    window.location.hash = '#/';
    render(<App />);

    await screen.findByTestId('dashboard-office-name');

    const navigation = within(screen.getByRole('navigation', { name: 'التنقل الرئيسي' }));
    const itemLabels = navigation.getAllByRole('link').map((link) => link.textContent?.trim());
    expect(itemLabels.indexOf('معلومات المطور')).toBe(itemLabels.indexOf('الإعدادات') + 1);

    fireEvent.click(navigation.getByRole('link', { name: 'معلومات المطور' }));
    expect(await screen.findByRole('heading', { name: 'معلومات المطور', level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'كنان مجيد' })).toBeTruthy();

    const youtube = screen.getByRole('link', { name: /زيارة القناة/ });
    expect(youtube.getAttribute('href')).toBe('https://youtube.com/@kinanmajeed?si=I2yuzJT2rRnEHLVg');
    expect(youtube.getAttribute('target')).toBe('_blank');
    expect(youtube.getAttribute('rel')).toBe('noopener noreferrer');

    const telegram = screen.getByRole('link', { name: /فتح تيليغرام/ });
    expect(telegram.getAttribute('href')).toBe('https://t.me/techtouch7');
    expect(telegram.getAttribute('target')).toBe('_blank');
    expect(telegram.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('يفتح روابط التواصل عبر متصفح النظام على أندرويد', async () => {
    await seedOfficeProfile();
    window.location.hash = '#/';
    render(<App />);
    await screen.findByTestId('dashboard-office-name');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'التنقل الرئيسي' })).getByRole('link', { name: 'معلومات المطور' }));
    await screen.findByRole('heading', { name: 'معلومات المطور', level: 1 });

    const nativePlatform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const browserOpen = vi.mocked(Browser.open);
    browserOpen.mockClear();
    fireEvent.click(screen.getByRole('link', { name: /زيارة القناة/ }));

    expect(browserOpen).toHaveBeenCalledWith({ url: 'https://youtube.com/@kinanmajeed?si=I2yuzJT2rRnEHLVg' });
    nativePlatform.mockRestore();
  });
});
