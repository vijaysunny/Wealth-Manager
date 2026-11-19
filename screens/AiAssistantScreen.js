/**
 * AiAssistantScreen.js - ask questions about your spending; bulk-categorize 'General' rows.
 * Only an aggregated monthly summary (totals per category / top merchants) is sent, never SMS text.
 */
import { View, Text, TextInput, ScrollView, SafeAreaView } from '../components/Theme';
import React, { useCallback, useState } from 'react';
import { Button, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { bulkUpdate } from '../utils/FeatureService';
import { isAiReady } from '../utils/ai/AiConfig';
import { PROVIDERS } from '../utils/ai/AiProviders';
import { aiInsights, aiCategorize, buildSpendingSummary, DEFAULT_CATEGORIES } from '../utils/ai/AiTasks';

const SUGGESTIONS = [
  'Where did my money go this month?',
  'Which categories are over budget?',
  'How does this month compare with last month?',
  'Where can I save ₹5,000 next month?',
];

const readJson = async (key, fallback) => {
  try {
    return JSON.parse((await Storage.getItem(key)) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

export default function AiAssistantScreen({ navigation }) {
  const [ready, setReady] = useState({ insights: false, categorize: false });
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]); // [{ q, a, provider }]
  const [busy, setBusy] = useState(false);
  const [generalCount, setGeneralCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setReady({ insights: await isAiReady('insights'), categorize: await isAiReady('categorize') });
        setGeneralCount(
          (await getAll()).filter((t) => t.type !== 'transfer' && t.category === 'General').length
        );
      })().catch(() => {});
    }, [])
  );

  const ask = async (q) => {
    const text = String(q || question).trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const summary = buildSpendingSummary(await getAll(), {
        budgets: await readJson('user_category_budgets', {}),
      });
      const { text: answer, provider } = await aiInsights(text, summary);
      setChat((c) => [{ q: text, a: answer, provider }, ...c]);
      setQuestion('');
    } catch (e) {
      Alert.alert('AI', e.message);
    } finally {
      setBusy(false);
    }
  };

  const categorizeAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const general = (await getAll()).filter((t) => t.type !== 'transfer' && t.category === 'General');
      const categories = await readJson('user_categories', DEFAULT_CATEGORIES);
      const map = await aiCategorize(general.slice(0, 200), { categories });
      const byCat = new Map();
      for (const [id, cat] of map) byCat.set(cat, [...(byCat.get(cat) || []), id]);
      for (const [cat, ids] of byCat) await bulkUpdate(ids, { category: cat });
      setGeneralCount(general.length - map.size);
      Alert.alert(
        'Categorized',
        `${map.size} of ${Math.min(general.length, 200)} transactions got a category.`
      );
    } catch (e) {
      Alert.alert('AI', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, padding: 16, backgroundColor: '#f5f5f5' }}>
      <Button title="Back" onPress={() => navigation.goBack()} />
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginVertical: 12 }}>AI Assistant</Text>
      {!ready.insights && !ready.categorize ? (
        <Text>
          AI is off. Turn on “Use AI” and save a free Gemini or Groq key in Settings → AI assistant.
        </Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {ready.categorize && (
            <View style={{ marginBottom: 16 }}>
              <Text>{generalCount} transactions are in “General”.</Text>
              <Button
                title="Categorize them with AI"
                disabled={busy || generalCount === 0}
                onPress={categorizeAll}
              />
            </View>
          )}
          {ready.insights && (
            <View>
              <TextInput
                value={question}
                onChangeText={setQuestion}
                placeholder="Ask about your spending…"
                multiline
                style={{ borderWidth: 1, borderColor: '#999', padding: 10, borderRadius: 8, minHeight: 60 }}
              />
              <Button title={busy ? 'Thinking…' : 'Ask'} disabled={busy} onPress={() => ask()} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 8 }}>
                {SUGGESTIONS.map((s) => (
                  <Text
                    key={s}
                    onPress={() => ask(s)}
                    style={{ color: '#2196F3', marginRight: 12, marginBottom: 6 }}
                  >
                    {s}
                  </Text>
                ))}
              </View>
              {busy && <ActivityIndicator />}
              {chat.map((m, i) => (
                <View key={i} style={{ backgroundColor: '#fff', borderRadius: 8, padding: 12, marginTop: 8 }}>
                  <Text style={{ fontWeight: '600' }}>{m.q}</Text>
                  <Text style={{ marginTop: 6 }}>{m.a}</Text>
                  <Text style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>
                    via {PROVIDERS[m.provider]?.label || m.provider} · AI can be wrong; check figures in
                    Analytics
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
