/**
 * AiSettingsPanel.js - Settings → AI assistant.
 * Keys are written straight to SecureStore and never shown again (only "saved ✓").
 * Opt-in: nothing is sent to a provider until "Use AI" is on.
 */
import { View, Text, TextInput } from './Theme';
import React, { useEffect, useState, useCallback } from 'react';
import { Button, Switch, Alert, Linking } from 'react-native';
import { PROVIDERS } from '../utils/ai/AiProviders';
import { loadAiSettings, saveAiSettings, getApiKey, setApiKey } from '../utils/ai/AiConfig';
import { testProvider } from '../utils/ai/AiClient';

const FEATURE_LABELS = {
  sms: 'Read bank SMS the parser misses',
  categorize: "Categorize 'General' transactions",
  statements: 'Read statements the parser misses',
  insights: 'Spending questions (AI Assistant)',
};
const input = { borderWidth: 1, borderColor: '#999', padding: 8, borderRadius: 8, marginVertical: 4 };

export default function AiSettingsPanel({ onOpenAssistant }) {
  const [settings, setSettings] = useState(null);
  const [hasKey, setHasKey] = useState({});
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(null);

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

  const update = async (patch) => setSettings(await saveAiSettings({ ...settings, ...patch }));

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

  const saveKey = (id) =>
    run(id, async () => {
      await setApiKey(id, drafts[id] || '');
      setDrafts((d) => ({ ...d, [id]: '' }));
      await refresh();
    });

  const test = (id) =>
    run(id, async () => {
      const key = drafts[id] || (await getApiKey(id));
      if (!key) throw new Error('Enter a key first.');
      const { model, reply } = await testProvider(id, key);
      Alert.alert(PROVIDERS[id].label, `Working ✓\nModel: ${model}\nReply: ${reply}`);
    });

  if (!settings) return null;
  const anyKey = Object.values(hasKey).some(Boolean);

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontWeight: '600' }}>Use AI</Text>
        <Switch
          value={settings.enabled}
          onValueChange={(enabled) =>
            run('toggle', async () => {
              if (enabled && !anyKey) throw new Error('Save at least one API key below first.');
              await update({ enabled });
            })
          }
        />
      </View>
      <Text style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
        When on, SMS text (long numbers masked), transaction titles or monthly totals are sent to the provider
        below. Providers are tried in order; free tiers first, the next is used if one fails or hits its
        limit.
      </Text>

      {settings.order.map((id, idx) => {
        const p = PROVIDERS[id];
        return (
          <View key={id} style={{ borderTopWidth: 1, borderColor: '#E5E7EB', paddingVertical: 8 }}>
            <Text style={{ fontWeight: '600' }}>
              {idx + 1}. {p.label} {hasKey[id] ? '· key saved ✓' : '· no key'}
            </Text>
            <Text style={{ fontSize: 12, color: '#2196F3' }} onPress={() => Linking.openURL(p.keyUrl)}>
              Get a {p.free ? 'free ' : ''}key: {p.keyUrl}
            </Text>
            <TextInput
              style={input}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={hasKey[id] ? 'Replace key (leave empty + Save to remove)' : 'Paste API key'}
              value={drafts[id] || ''}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [id]: v }))}
            />
            <TextInput
              style={input}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Model (optional, auto-picked if empty)"
              value={settings.models[id] || ''}
              onChangeText={(v) => setSettings((s) => ({ ...s, models: { ...s.models, [id]: v.trim() } }))}
              onEndEditing={() => update({}).catch(() => {})}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button title={busy === id ? '…' : 'Save key'} disabled={!!busy} onPress={() => saveKey(id)} />
              <Button title="Test" disabled={!!busy} onPress={() => test(id)} />
              {idx > 0 && (
                <Button
                  title="Move up"
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
        );
      })}

      <Text style={{ fontWeight: '600', marginTop: 8 }}>Use AI for</Text>
      {Object.entries(FEATURE_LABELS).map(([f, label]) => (
        <View key={f} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1 }}>{label}</Text>
          <Switch
            value={settings.features[f] !== false}
            disabled={!settings.enabled}
            onValueChange={(v) => update({ features: { ...settings.features, [f]: v } })}
          />
        </View>
      ))}
      {onOpenAssistant && (
        <View style={{ marginTop: 8 }}>
          <Button title="Open AI Assistant" onPress={onOpenAssistant} />
        </View>
      )}
    </View>
  );
}
