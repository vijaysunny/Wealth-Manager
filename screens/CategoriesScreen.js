/** Categories (C5.8; moved out of Settings). Add and remove spending categories. */
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, Chip, ListRow, ScreenHeader } from '../components/ui';

export const DEFAULT_CATS = [
  'Food',
  'Transport',
  'Shopping',
  'Bills',
  'Health',
  'Education',
  'Entertainment',
  'Salary',
  'Business',
  'Investment',
  'Loan/EMI',
  'Insurance',
  'Rent',
  'UPI Transfer',
  'General',
];

export const loadCategories = async () =>
  JSON.parse((await Storage.getItem('user_categories')) || 'null') || DEFAULT_CATS;

export default function CategoriesScreen({ navigation }) {
  const t = useTokens();
  const [cats, setCats] = useState([]);
  const [text, setText] = useState('');

  useFocusEffect(
    useCallback(() => {
      loadCategories().then(setCats);
    }, [])
  );

  const save = async (next) => {
    setCats(next);
    await Storage.setItem('user_categories', JSON.stringify(next));
  };
  const add = async () => {
    const name = text.trim();
    if (!name) return;
    if (cats.some((c) => c.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Category', `${name} is already in the list.`);
      return;
    }
    await save([...cats, name]);
    setText('');
  };
  const removeCat = (c) =>
    Alert.alert('Remove category?', `${c} is removed from the list. Past transactions keep it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => save(cats.filter((x) => x !== c)) },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Categories" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}
        keyboardShouldPersistTaps="handled"
      >
        <Card padding={0} style={{ paddingHorizontal: space.lg, marginBottom: space.lg }}>
          <ListRow
            label="Payee rules"
            sublabel="Rename, categorise and tag new transactions from a payee"
            onPress={() => navigation.navigate('PayeeRules')}
          />
        </Card>
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
          <TextInput
            testID="new-category"
            accessibilityLabel="New category"
            value={text}
            onChangeText={setText}
            onSubmitEditing={add}
            placeholder="New category"
            placeholderTextColor={t.placeholder}
            style={{
              flex: 1,
              minHeight: 48,
              borderWidth: 1,
              borderColor: t.inputBorder,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
              backgroundColor: t.card,
              color: t.text,
              fontFamily: fonts.body,
              fontSize: 16,
            }}
          />
          <AppButton title="Add" icon="add" onPress={add} />
        </View>
        <Text style={{ color: t.muted, fontFamily: fonts.body, marginVertical: space.md }}>
          {cats.length} categories. Tap × to remove one.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {cats.map((c) => (
            <Chip key={c} label={c} onRemove={() => removeCat(c)} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
