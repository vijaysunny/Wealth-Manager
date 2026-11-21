/**
 * Goals (Phase 12 C5.7, docs/design/Goals.png).
 * EmptyState with Create a goal · "Start from" templates · goal cards (progress, saved of
 * target, monthly saving needed, where it is kept) with Add money / Edit / Delete.
 */
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import Storage from '../data/Storage';
import { formatMoney } from '../utils/Format';
import { goalPlan, GOAL_TEMPLATES } from '../utils/GoalMath';
import { useTokens } from '../components/Theme';
import { fonts, radius, space } from '../components/tokens';
import { AppButton, Card, EmptyState, IconButton, Section } from '../components/ui';

const TONES = (t) => ({ income: t.income, primary: t.primary, violet: '#5B3CC4', expense: t.expense });

export default function GoalScreen({ navigation }) {
  const t = useTokens();
  const [goals, setGoals] = useState([]);

  const load = useCallback(async () => {
    setGoals(JSON.parse((await Storage.getItem('user_goals')) || '[]'));
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const deleteGoal = (goal) =>
    Alert.alert(
      'Delete goal?',
      `${goal.name} and its plan are removed. Your account balances do not change.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const next = goals.filter((g) => g.id !== goal.id);
            setGoals(next);
            await Storage.setItem('user_goals', JSON.stringify(next));
          },
        },
      ]
    );

  const tones = TONES(t);
  const templates = (
    <Section title="Start from">
      <View style={styles.grid}>
        {GOAL_TEMPLATES.map((g) => (
          <Pressable
            key={g.key}
            accessibilityRole="button"
            accessibilityLabel={`Start a goal: ${g.name}`}
            onPress={() => navigation.navigate('AddGoal', { template: g.key })}
            style={({ pressed }) => [
              styles.tile,
              { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Ionicons name={g.icon} size={26} color={tones[g.tone]} />
            <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 16, marginTop: space.md }}>
              {g.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </Section>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={{ flex: 1, color: t.text, fontFamily: fonts.display, fontSize: 30 }}
        >
          Goals
        </Text>
        {goals.length > 0 && (
          <IconButton
            icon="add-circle-outline"
            label="Create a goal"
            color={t.primary}
            onPress={() => navigation.navigate('AddGoal')}
          />
        )}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: space.xxl }}>
        {goals.length === 0 ? (
          <>
            <EmptyState
              icon="flag-outline"
              title="Save for something specific"
              body="Set a target and a date. Each contribution marks money in your accounts for that goal. Moving money between accounts is a separate transfer."
              action={{ label: 'Create a goal', icon: 'add', onPress: () => navigation.navigate('AddGoal') }}
            />
            {templates}
          </>
        ) : (
          <>
            {goals.map((goal) => {
              const plan = goalPlan(goal);
              const saved = parseFloat(goal.savedAmount) || 0;
              const target = parseFloat(goal.targetAmount) || 0;
              return (
                <Card key={goal.id} testID={`goal-${goal.id}`}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontFamily: fonts.display, fontSize: 20 }}>
                        {goal.name}
                      </Text>
                      <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 14, marginTop: 2 }}>
                        By{' '}
                        {new Date(goal.deadline).toLocaleDateString('en-IN', {
                          month: 'short',
                          year: 'numeric',
                        })}{' '}
                        · {plan.monthsLeft} month{plan.monthsLeft === 1 ? '' : 's'} left
                      </Text>
                    </View>
                    <IconButton
                      icon="trash-outline"
                      label={`Delete ${goal.name}`}
                      color={t.muted}
                      onPress={() => deleteGoal(goal)}
                    />
                  </View>
                  <View style={[styles.track, { backgroundColor: t.divider }]}>
                    <View
                      style={[
                        styles.fill,
                        {
                          width: `${Math.max(2, plan.progress * 100)}%`,
                          backgroundColor: plan.done ? t.income : t.primary,
                        },
                      ]}
                    />
                  </View>
                  <View
                    style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}
                  >
                    <Text style={{ color: t.text, fontFamily: fonts.semibold, fontSize: 15 }}>
                      {formatMoney(Math.round(saved))}
                      <Text style={{ color: t.muted, fontFamily: fonts.body }}>
                        {' '}
                        of {formatMoney(Math.round(target))}
                      </Text>
                    </Text>
                    <Text style={{ color: t.muted, fontFamily: fonts.medium, fontSize: 15 }}>
                      {Math.round(plan.progress * 100)}%
                    </Text>
                  </View>
                  <View style={[styles.need, { backgroundColor: plan.done ? '#E6F4EC' : t.primarySoft }]}>
                    <Ionicons
                      name={plan.done ? 'checkmark-circle-outline' : 'calendar-outline'}
                      size={20}
                      color={plan.done ? t.income : t.primary}
                    />
                    <Text
                      style={{
                        flex: 1,
                        color: t.text,
                        fontFamily: fonts.medium,
                        fontSize: 15,
                        marginLeft: space.sm,
                      }}
                    >
                      {plan.done
                        ? 'Target reached'
                        : `Save ${formatMoney(Math.round(plan.monthlyNeed))} a month${Number(goal.roi) > 0 ? ` at ${goal.roi}% return` : ''}`}
                    </Text>
                  </View>
                  <Text style={{ color: t.muted, fontFamily: fonts.body, fontSize: 13, marginTop: space.sm }}>
                    Kept in: {goal.linkedAsset || 'not set'}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
                    <AppButton
                      title="Add money"
                      size="sm"
                      icon="add"
                      style={{ flex: 1 }}
                      accessibilityLabel={`Add money to ${goal.name}`}
                      onPress={() => navigation.navigate('MoneyTool', { tab: 'Goals', goalId: goal.id })}
                    />
                    <AppButton
                      title="Edit"
                      size="sm"
                      variant="secondary"
                      style={{ flex: 1 }}
                      accessibilityLabel={`Edit ${goal.name}`}
                      onPress={() => navigation.navigate('AddGoal', { goal })}
                    />
                  </View>
                </Card>
              );
            })}
            {templates}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xl,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  tile: {
    width: '48.5%',
    minHeight: 104,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: space.lg },
  fill: { height: 8, borderRadius: 4 },
  need: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
  },
});
