// Design tokens (Phase 12 plan C1). Pure data: no React Native imports, so tests can check contrast.
// Every text/background pair used by the UI must reach WCAG 4.5:1 (see __tests__/tokens.test.js).

export const light = {
  bg: '#F5F6F8',
  card: '#FFFFFF',
  border: '#E3E6EC',
  divider: '#EEF0F4',
  inputBorder: '#D5DAE3',
  text: '#0E1726',
  text2: '#3A4456',
  muted: '#5B6475',
  placeholder: '#6B7385',
  primary: '#1F4FD8',
  primaryPressed: '#173EA8',
  primarySoft: '#E8EEFF',
  onPrimary: '#FFFFFF',
  expense: '#C2362B',
  income: '#0E7C4A',
  ink: '#0E1726',
  inkCard: '#1B2638',
  inkMuted: '#C9D2E3',
  warnBg: '#FFF7E8',
  warnBorder: '#F3D9A4',
  warnText: '#6B4600',
  dangerBg: '#FFF1F0',
  incomeBg: '#E7F5EC',
  dangerBorder: '#F2C4BF',
  dangerText: '#7A1A24',
  danger: '#97212E',
  switchOff: '#C5CBD6',
};

export const dark = {
  bg: '#0F141C',
  card: '#18202B',
  border: '#2A3342',
  divider: '#222B38',
  inputBorder: '#3A4456',
  text: '#E6EAF0',
  text2: '#C3CAD6',
  muted: '#9AA4B5',
  placeholder: '#8C96A8',
  primary: '#8AA8FF',
  primaryPressed: '#6F8FEA',
  primarySoft: '#22304D',
  // Light primary in dark mode: button labels use dark ink, not white, to keep 4.5:1.
  onPrimary: '#0E1726',
  expense: '#F08A80',
  income: '#5CC998',
  ink: '#0A0E14',
  inkCard: '#1B2638',
  inkMuted: '#C9D2E3',
  warnBg: '#2E2410',
  warnBorder: '#5C4A1F',
  warnText: '#F5D48A',
  dangerBg: '#33171A',
  incomeBg: '#12301F',
  dangerBorder: '#5E2A2F',
  dangerText: '#F4B4B0',
  danger: '#F08A80',
  switchOff: '#4A5466',
};

export const tokens = { light, dark };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
export const radius = { sm: 10, md: 12, lg: 16, xl: 18, xxl: 20, pill: 999 };

// Font family names as registered in App.js (useFonts). Inter for text, Space Grotesk for figures.
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displaySemi: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

export const type = {
  display: { fontFamily: fonts.display, fontSize: 34 },
  title: { fontFamily: fonts.display, fontSize: 22 },
  section: { fontFamily: fonts.displaySemi, fontSize: 17 },
  body: { fontFamily: fonts.body, fontSize: 15 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15 },
  meta: { fontFamily: fonts.body, fontSize: 12 },
  overline: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' },
};

/** Minimum touch target and control heights (C1). */
export const sizes = { tap: 44, buttonLg: 52, buttonMd: 44, buttonSm: 36, tabBar: 80, row: 52 };

export const palette = (isDark) => (isDark ? dark : light);

// ── WCAG contrast (used by tests and to check new token pairs) ──
const channel = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const luminance = (hex) => {
  const h = String(hex).replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(full.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

export default tokens;
