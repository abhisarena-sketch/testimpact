export async function loadForm() {
  const mod = await import('../components/LoginForm');
  return mod.LoginForm;
}

export async function loadLocale(lang: string) {
  return import(`../locales/${lang}.json`);
}
