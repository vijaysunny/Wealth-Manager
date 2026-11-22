/**
 * AI assistant (Phase 12 C5.9, docs/design/AI assistant.png).
 * Status card (Use AI + providers) · "Ask about your money" chips (incl. categorize the
 * 'General' rows) · chat bubbles · input bar fixed at the bottom.
 * Only an aggregated monthly summary (totals per category / top merchants) is sent for
 * questions, never SMS text.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { getAll } from '../data/TransactionRepo';
import { bulkUpdate } from '../utils/FeatureService';
import { isAiReady, SHORT_NAMES } from '../utils/ai/AiConfig';
import { aiInsights, aiCategorize, buildSpendingSummary, DEFAULT_CATEGORIES } from '../utils/ai/AiTasks';
import AiSettingsPanel from '../components/AiSettingsPanel';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { Banner, Section, ScreenHeader } from '../components/ui';

const SUGGESTIONS = [
  'Where did my money go this month?',
  'Which subscriptions can I cut?',
  'How does this month compare with last month?',
];

const readJson = async (key, fallback) => {
  try {
    return JSON.parse((await Storage.getItem(key)) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
};

export default function AiAssistantScreen({ navigation }) {
  const t = useTokens();
  const [ready, setReady] = useState({ insights: false, categorize: false });
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState([]); // [{ q, a, provider }] oldest first
  const [busy, setBusy] = useState(false);
  const [generalCount, setGeneralCount] = useState(0);
  const [geminiFailed, setGeminiFailed] = useState(false); // A2.6: show the Groq hint
  const scroller = useRef(null);

  const refresh = useCallback(async () => {
    setReady({ insights: await isAiReady('insights'), categorize: await isAiReady('categorize') });
    setGeneralCount((await getAll()).filter((x) => x.type !== 'transfer' && x.category === 'General').length);
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => {});
    }, [refresh])
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
      setChat((c) => [...c, { q: text, a: answer, provider }]);
      setGeminiFailed(false);
      setQuestion('');
      setTimeout(() => scroller.current?.scrollToEnd?.({ animated: true }), 50);
    } catch (e) {
      if ((e.attempts || []).some((a) => a.provider === 'gemini')) {
        setGeminiFailed(true);
        scroller.current?.scrollTo?.({ y: 0, animated: true });
      }
      Alert.alert('AI', e.message);
    } finally {
      setBusy(false);
    }
  };

  const categorizeAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const general = (await getAll()).filter((x) => x.type !== 'transfer' && x.category === 'General');
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

  const off = !ready.insights && !ready.categorize;
  const chip = (label, onPress, key) => (
    <Pressable
      key={key || label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        backgroundColor: t.card,
        borderColor: t.border,
        borderWidth: 1,
        borderRadius: radius.pill,
        paddingHorizontal: space.lg,
        minHeight: 44,
        justifyContent: 'center',
        marginBottom: space.sm,
        opacity: pressed || busy ? 0.6 : 1,
      })}
    >
      <Text style={{ color: t.text, fontFamily: fonts.medium, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="AI assistant" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <AiSettingsPanel geminiFailed={geminiFailed} onChange={() => refresh().catch(() => {})} />

          {off ? (
            <View testID="ai-off-card">
              <Banner
                tone="info"
                title="AI is off"
                body="Turn on Use AI above and save a free Gemini or Groq key. Nothing is sent until then."
              />
            </View>
          ) : (
            <Section title="Ask about your money">
              {ready.insights && SUGGESTIONS.map((s) => chip(s, () => ask(s)))}
              {ready.categorize &&
                generalCount > 0 &&
                chip(`Categorize ${generalCount} “General” items`, categorizeAll, 'categorize')}
            </Section>
          )}

          {chat.map((m, i) => (
            <View key={i} style={{ marginTop: space.md }}>
              <View
                style={{
                  alignSelf: 'flex-end',
                  maxWidth: '85%',
                  backgroundColor: t.primary,
                  borderRadius: radius.lg,
                  borderBottomRightRadius: 4,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.md,
                }}
              >
                <Text style={{ color: t.onPrimary, fontFamily: fonts.medium, fontSize: 16 }}>{m.q}</Text>
              </View>
              <View
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '92%',
                  backgroundColor: t.card,
                  borderColor: t.border,
                  borderWidth: 1,
                  borderRadius: radius.lg,
                  borderBottomLeftRadius: 4,
                  padding: space.lg,
                  marginTop: space.sm,
                }}
              >
                <Text
                  selectable
                  style={{ color: t.text, fontFamily: fonts.body, fontSize: 16, lineHeight: 23 }}
                >
                  {m.a}
                </Text>
                <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: space.sm }}>
                  via {SHORT_NAMES[m.provider] || m.provider} · AI can be wrong; check figures in Reports
                </Text>
              </View>
            </View>
          ))}
          {busy ? <ActivityIndicator style={{ marginTop: space.md }} color={t.primary} /> : null}
        </ScrollView>

        {ready.insights ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              padding: space.md,
              paddingHorizontal: space.lg,
              borderTopWidth: 1,
              borderColor: t.border,
              backgroundColor: t.bg,
            }}
          >
            <TextInput
              testID="ai-question"
              accessibilityLabel="Ask about your spending"
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={() => ask()}
              returnKeyType="send"
              placeholder="Ask about your spending"
              placeholderTextColor={t.placeholder}
              style={{
                flex: 1,
                minHeight: 52,
                borderWidth: 1,
                borderColor: t.inputBorder,
                borderRadius: radius.pill,
                paddingHorizontal: space.lg,
                backgroundColor: t.card,
                color: t.text,
                fontFamily: fonts.body,
                fontSize: 16,
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={busy || !question.trim()}
              onPress={() => ask()}
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: t.primary,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: busy || !question.trim() ? 0.5 : 1,
              }}
            >
              <Ionicons name="arrow-forward" size={24} color={t.onPrimary} />
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
