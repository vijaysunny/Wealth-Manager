/**
 * AiSettingsPanel.js (C5.9 status card) - shown at the top of AI assistant.
 * Use AI switch with the privacy note, then providers in order: status ("Working · model",
 * "No key", or the API error) and Test / Add key. Tapping a provider opens its key editor.
 * Keys are written straight to SecureStore and never shown again.
 * Opt-in: nothing is sent to a provider until "Use AI" is on.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { PROVIDERS } from '../utils/ai/AiProviders';
import { loadAiSettings, saveAiSettings, getApiKey, setApiKey, SHORT_NAMES } from '../utils/ai/AiConfig';
import { runProviderTest } from '../utils/ai/AiClient';
import { useTokens } from './Theme';
import { fonts, radius, space } from './tokens';
import AppButton from './ui/AppButton';
import AppSwitch from './ui/AppSwitch';
import Collapsible from './ui/Collapsible';

const FEATURE_LABELS = {
  sms: 'Read bank SMS the parser misses',
  categorize: "Categorize 'General' transactions",
  statements: 'Read statements the parser misses',
  insights: 'Spending questions (AI assistant)',
};

/**
 * geminiFailed (A2.6): a question just failed on Gemini; with no Groq key, the Gemini row shows
 * a hint and an Add key button for Groq.
 */
export default function AiSettingsPanel({ onChange, geminiFailed = false }) {
  const t = useTokens();
  const [settings, setSettings] = useState(null);
  const [hasKey, setHasKey] = useState({});
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState({}); // A9: last Test result per provider
  const [open, setOpen] = useState(null); // provider whose key editor is open

  const refresh = useCallback(async () => {
    setSettings(await loadAiSettings());
    const entries = await Promise.all(
      Object.keys(PROVIDERS).map(async (id) => [id, !!(await getApiKey(id))])
    );
    setHasKey(Object.fromEntries(entries));
  }, []);
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const update = async (patch) => {
    const next = await saveAiSettings({ ...settings, ...patch });
    setSettings(next);
    onChange?.(next);
  };

  const run = async (label, task) => {
    if (busy) return;
    setBusy(label);
    try {
      await task();
    } catch (e) {
      Alert.alert('AI', e.message);
    } finally {
      setBusy(null);
    }
  };

  const checkKey = async (id, key) => {
    setStatus((st) => ({ ...st, [id]: { ok: null, line: 'Testing…' } }));
    const result = await runProviderTest(id, key);
    setStatus((st) => ({ ...st, [id]: result }));
    return result;
  };

  const saveKey = (id) =>
    run(id, async () => {
      const key = (drafts[id] || '').trim();
      const firstKey = !!key && !Object.values(hasKey).some(Boolean);
      await setApiKey(id, key);
      setDrafts((d) => ({ ...d, [id]: '' }));
      await refresh();
      onChange?.();
      if (!key) {
        setStatus((st) => ({ ...st, [id]: { ok: false, line: 'No key' } }));
        return;
      }
      setOpen(null);
      // A9: test right away, so a bad key or "no suitable model" shows here, not later
      await checkKey(id, key);
      if (firstKey && !settings.enabled)
        Alert.alert('Turn on AI now?', 'Nothing is sent to the provider until AI is on.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Turn on', onPress: () => update({ enabled: true }).catch(() => {}) },
        ]);
    });

  const test = (id) =>
    run(`test-${id}`, async () => {
      const key = drafts[id] || (await getApiKey(id));
      if (!key) throw new Error('Enter a key first.');
      await checkKey(id, key);
    });

  if (!settings) return null;
  const anyKey = Object.values(hasKey).some(Boolean);

  const statusLine = (id, idx) => {
    if (status[id]) return status[id];
    if (hasKey[id]) return { ok: null, line: 'Key saved · tap Test to check it' };
    const prev = idx > 0 ? SHORT_NAMES[settings.order[idx - 1]] : null;
    return { ok: null, line: prev ? `No key · used if ${prev} fails` : 'No key' };
  };

  return (
    <View
      testID="ai-status-card"
      style={{
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.lg,
        paddingHorizontal: space.lg,
        marginBottom: space.md,
      }}
    >
      <AppSwitch
        label="Use AI"
        sublabel="Sends SMS text (numbers masked) or monthly totals to the provider"
        value={settings.enabled}
        onValueChange={(enabled) =>
          run('toggle', async () => {
            if (enabled && !anyKey) throw new Error('Save at least one API key below first.');
            await update({ enabled });
          })
        }
      />
      <View style={{ height: 1, backgroundColor: t.divider }} />
      {settings.order.map((id, idx) => {
        const p = PROVIDERS[id];
        const st = statusLine(id, idx);
        const editing = open === id;
        return (
          <View key={id} style={{ paddingVertical: space.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${p.label}: ${hasKey[id] ? 'key saved' : 'no key'}. Edit key`}
                accessibilityState={{ expanded: editing }}
                onPress={() => setOpen(editing ? null : id)}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.sm,
                    backgroundColor: idx === 0 ? t.primarySoft : t.divider,
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: space.md,
                  }}
                >
                  <Text
                    style={{
                      color: idx === 0 ? t.primary : t.text2,
                      fontFamily: fonts.semibold,
                      fontSize: 15,
                    }}
                  >
                    {idx + 1}
                  </Text>
                </View>
                <View style={{ flex: 1, paddingRight: space.sm }}>
                  <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16 }}>
                    {p.label} {hasKey[id] ? '· key saved' : '· no key'}
                  </Text>
                  <Text
                    testID={`ai-status-${id}`}
                    style={{
                      fontFamily: st.ok ? fonts.medium : fonts.body,
                      fontSize: 13,
                      marginTop: 2,
                      color: st.ok ? t.income : st.ok === false ? t.dangerText : t.muted,
                    }}
                  >
                    {st.line}
                  </Text>
                </View>
              </Pressable>
              {hasKey[id] ? (
                <AppButton
                  title="Test"
                  variant="secondary"
                  size="sm"
                  accessibilityLabel={`Test ${p.label}`}
                  loading={busy === `test-${id}`}
                  disabled={!!busy}
                  onPress={() => test(id)}
                />
              ) : (
                <AppButton
                  title="Add key"
                  variant="secondary"
                  size="sm"
                  accessibilityLabel={`Add key for ${p.label}`}
                  onPress={() => setOpen(editing ? null : id)}
                />
              )}
            </View>
            {id === 'gemini' && (geminiFailed || st.ok === false) && PROVIDERS.groq && !hasKey.groq ? (
              <View testID="ai-groq-hint" style={{ marginTop: space.sm, marginLeft: 48 }}>
                <Text style={{ color: t.warnText, fontFamily: fonts.body, fontSize: 13, lineHeight: 18 }}>
                  Gemini is slow or down right now. Add a free Groq key so questions still work.
                </Text>
                <View style={{ alignSelf: 'flex-start', marginTop: space.xs }}>
                  <AppButton
                    title="Add key"
                    variant="secondary"
                    size="sm"
                    accessibilityLabel="Add a Groq key"
                    onPress={() => setOpen('groq')}
                  />
                </View>
              </View>
            ) : null}
            {editing || !anyKey ? (
              <View style={{ marginTop: space.sm, marginLeft: 48 }}>
                <Text
                  accessibilityRole="link"
                  style={{ color: t.primary, fontFamily: fonts.medium, fontSize: 13 }}
                  onPress={() => Linking.openURL(p.keyUrl)}
                >
                  Get a {p.free ? 'free ' : ''}key: {p.keyUrl}
                </Text>
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: t.inputBorder,
                    borderRadius: radius.md,
                    padding: space.md,
                    marginTop: space.sm,
                    color: t.text,
                    fontFamily: fonts.body,
                  }}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={hasKey[id] ? 'Replace key (leave empty + Save to remove)' : 'Paste API key'}
                  placeholderTextColor={t.placeholder}
                  value={drafts[id] || ''}
                  onChangeText={(v) => setDrafts((d) => ({ ...d, [id]: v }))}
                />
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: t.inputBorder,
                    borderRadius: radius.md,
                    padding: space.md,
                    marginTop: space.sm,
                    color: t.text,
                    fontFamily: fonts.body,
                  }}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Model (optional, picked automatically)"
                  placeholderTextColor={t.placeholder}
                  value={settings.models[id] || ''}
                  onChangeText={(v) =>
                    setSettings((s) => ({ ...s, models: { ...s.models, [id]: v.trim() } }))
                  }
                  onEndEditing={() => update({}).catch(() => {})}
                />
                <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xs }}>
                  <AppButton
                    title="Save key"
                    size="sm"
                    loading={busy === id}
                    disabled={!!busy}
                    onPress={() => saveKey(id)}
                  />
                  {idx > 0 && (
                    <AppButton
                      title="Move up"
                      variant="secondary"
                      size="sm"
                      disabled={!!busy}
                      onPress={() => {
                        const order = [...settings.order];
                        [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                        update({ order });
                      }}
                    />
                  )}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={{ marginHorizontal: -space.lg }}>
        <Collapsible
          title="Use AI for"
          summary="SMS, categories, statements, questions"
          style={{ borderWidth: 0, marginBottom: 0 }}
        >
          {Object.entries(FEATURE_LABELS).map(([f, label]) => (
            <AppSwitch
              key={f}
              label={label}
              value={settings.features[f] !== false}
              disabled={!settings.enabled}
              onValueChange={(v) => update({ features: { ...settings.features, [f]: v } })}
            />
          ))}
        </Collapsible>
      </View>
    </View>
  );
}
