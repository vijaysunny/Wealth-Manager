/** D3 / C1: every text/background pair the UI uses reaches WCAG 4.5:1, in light and dark. */
import { light, dark, contrast, luminance, type, sizes } from '../components/tokens';

const PAIRS = [
  ['text', 'bg'],
  ['text', 'card'],
  ['muted', 'card'],
  ['muted', 'bg'],
  ['text2', 'card'],
  ['placeholder', 'card'],
  ['primary', 'card'],
  ['onPrimary', 'primary'],
  ['warnText', 'warnBg'],
  ['dangerText', 'dangerBg'],
  ['onPrimary', 'danger'],
  ['inkMuted', 'ink'],
  ['inkMuted', 'inkCard'],
  ['expense', 'card'],
  ['income', 'card'],
  ['primary', 'primarySoft'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s tokens', (_, t) => {
  test('both palettes define the same keys', () => {
    expect(Object.keys(t).sort()).toEqual(Object.keys(light).sort());
  });
  test.each(PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

test('white on light primary (button labels) ≥ 4.5:1', () => {
  expect(contrast('#FFFFFF', light.primary)).toBeGreaterThanOrEqual(4.5);
});

test('contrast helper: black on white is 21, same colour is 1, 3-digit hex works', () => {
  expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
  expect(contrast('#123456', '#123456')).toBeCloseTo(1, 5);
  expect(luminance('#fff')).toBeCloseTo(1, 5);
});

test('type scale and sizes', () => {
  expect(type.display.fontSize).toBe(34);
  expect(type.overline.textTransform).toBe('uppercase');
  expect(sizes.tap).toBeGreaterThanOrEqual(44);
  expect(sizes.buttonLg).toBe(52);
});
