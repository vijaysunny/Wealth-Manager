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
  dangerBorder: '#5E2A2F',
  dangerText: '#F4B4B0',
  danger: '#F08A80',
  switchOff: '#4A5466',
};

export const tokens = { light, dark };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 };
export const radius = { sm: 10, md: 12, lg: 16, xl: 18, xxl: 20, pill: 999 };

export const palette = (isDark) => (isDark ? dark : light);

export default tokens;
