import { Text, View, ScrollView, TouchableOpacity, SafeAreaView } from '../components/Theme';
import React, { useState, useCallback } from 'react';
import { StyleSheet, Button } from 'react-native';
import AsyncStorage from '../data/Storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { formatMoney } from '../utils/Format';
export default function GoalScreen({
  navigation
}) {
  const [goals, setGoals] = useState([]);
  useFocusEffect(useCallback(() => {
    loadGoals();
  }, []));
  const loadGoals = async () => {
    const json = await AsyncStorage.getItem('user_goals');
    const data = json ? JSON.parse(json) : [];

    // Recalculate calculations for display
    const processed = data.map(g => {
      // Calculation Logic
      const target = parseFloat(g.targetAmount);
      const current = parseFloat(g.savedAmount);
      const rate = parseFloat(g.roi) / 100 / 12; // Monthly rate
      const today = new Date();
      const deadline = new Date(g.deadline);

      // Months remaining
      const months = Math.max(1, (deadline.getFullYear() - today.getFullYear()) * 12 + (deadline.getMonth() - today.getMonth()));

      // Gap to cover
      // Future Value of Current Savings: FV = PV * (1+r)^n
      const fvCurrent = current * Math.pow(1 + rate, months);
      const gap = target - fvCurrent;

      // Monthly SIP Needed: PMT = Gap * r / ((1+r)^n - 1)
      let monthlyNeed = 0;
      if (gap > 0 && rate > 0) {
        monthlyNeed = gap * rate / (Math.pow(1 + rate, months) - 1);
      } else if (gap > 0) {
        monthlyNeed = gap / months;
      }
      return {
        ...g,
        monthsLeft: months,
        monthlyNeed: Math.max(0, monthlyNeed),
        progress: target > 0 ? current / target : 0
      };
    });
    setGoals(processed);
  };
  const deleteGoal = async id => {
    const newGoals = goals.filter(g => g.id !== id);
    setGoals(newGoals);
    await AsyncStorage.setItem('user_goals', JSON.stringify(newGoals));
  };
  return <SafeAreaView style={styles.container}>
      <Button title="Contributions and goal history" onPress={() => navigation.navigate('Tools', {
      tab: 'Goals'
    })} />
      <View style={styles.header}>
        <Text style={styles.title}>Goal Planning</Text>
        <TouchableOpacity onPress={() => navigation.navigate('AddGoal')}>
            <Ionicons name="add-circle" size={32} color="#2196F3" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{
      padding: 20
    }}>
        {goals.length === 0 && <View style={styles.emptyState}>
                <Ionicons name="flag-outline" size={64} color="#ccc" />
                <Text style={{
          color: '#999',
          marginTop: 10
        }}>No goals set yet. Start planning!</Text>
            </View>}

        {goals.map(goal => <View key={goal.id} style={styles.card}>
                <View style={styles.cardHeader}>
                    <View>
                        <Text style={styles.goalName}>{goal.name}</Text>
                        <Text style={styles.goalDeadline}>Target: {new Date(goal.deadline).toDateString()}</Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteGoal(goal.id)}>
                        <Ionicons name="trash-outline" size={20} color="#999" />
                    </TouchableOpacity>
                </View>

                {/* Progress Bar */}
                <View style={styles.progressBg}>
                    <View style={[styles.progressFill, {
            width: `${Math.min(100, goal.progress * 100)}%`
          }]} />
                </View>
                <View style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: 15
        }}>
                    <Text style={{
            fontSize: 12,
            color: '#666'
          }}>Saved: {formatMoney(parseFloat(goal.savedAmount) || 0)}</Text>
                    <Text style={{
            fontSize: 12,
            fontWeight: 'bold'
          }}>Target: {formatMoney(parseFloat(goal.targetAmount) || 0)}</Text>
                </View>

                {/* Tracking Info */}
                <View style={styles.infoBox}>
                    <Text style={styles.infoLabel}>Where is it saved?</Text>
                    <Text style={styles.infoValue}>{goal.linkedAsset || 'Not Specified'}</Text>
                </View>

                {/* Requirement Calculation */}
                {goal.monthlyNeed > 0 ? <View style={styles.calcBox}>
                        <Ionicons name="calculator" size={20} color="#fff" style={{
            marginRight: 10
          }} />
                        <View>
                            <Text style={{
              color: '#BBDEFB',
              fontSize: 11
            }}>Required Monthly Savings</Text>
                            <Text style={{
              color: '#fff',
              fontWeight: 'bold',
              fontSize: 16
            }}>{formatMoney(Math.round(goal.monthlyNeed))}/mo</Text>
                        </View>
                    </View> : <View style={[styles.calcBox, {
          backgroundColor: '#4CAF50'
        }]}>
                        <Ionicons name="checkmark-circle" size={24} color="#fff" style={{
            marginRight: 10
          }} />
                        <Text style={{
            color: '#fff',
            fontWeight: 'bold'
          }}>On Track / Goal Reached!</Text>
                    </View>}
            </View>)}
      </ScrollView>
    </SafeAreaView>;
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9f9f9'
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold'
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 100
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 15,
    padding: 20,
    marginBottom: 20,
    elevation: 3
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15
  },
  goalName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333'
  },
  goalDeadline: {
    fontSize: 12,
    color: '#999'
  },
  progressBg: {
    height: 10,
    backgroundColor: '#eee',
    borderRadius: 5,
    marginBottom: 5
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#2196F3',
    borderRadius: 5
  },
  infoBox: {
    backgroundColor: '#F5F5F5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10
  },
  infoLabel: {
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase'
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333'
  },
  calcBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1976D2',
    padding: 15,
    borderRadius: 10
  }
});
