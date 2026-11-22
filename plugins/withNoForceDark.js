/**
 * Phase 13 A3: some Android skins (MIUI/HyperOS) force-darken apps that don't opt out, which
 * turned the light-pinned welcome text unreadable. Sets android:forceDarkAllowed=false on AppTheme.
 */
const { withAndroidStyles } = require('expo/config-plugins');

const ITEM = 'android:forceDarkAllowed';

const setNoForceDark = (styles) => {
  const list = styles?.resources?.style || [];
  const theme = list.find((s) => s.$ && s.$.name === 'AppTheme');
  if (!theme) return styles;
  theme.item = (theme.item || []).filter((i) => !(i.$ && i.$.name === ITEM));
  theme.item.push({ $: { name: ITEM }, _: 'false' });
  return styles;
};

const withNoForceDark = (config) =>
  withAndroidStyles(config, (cfg) => {
    cfg.modResults = setNoForceDark(cfg.modResults);
    return cfg;
  });

module.exports = withNoForceDark;
module.exports.setNoForceDark = setNoForceDark;
