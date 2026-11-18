// utils/icons.js

// 1. Helper to guess icon based on name (Auto-detection)
export const getCategoryIcon = category => {
  if (!category) return {
    name: 'pricetag',
    color: '#607D8B'
  };
  const lower = category.toLowerCase();

  // Food
  if (lower.includes('food') || lower.includes('zomato') || lower.includes('swiggy') || lower.includes('coffee')) return {
    name: 'fast-food',
    color: '#FF9800'
  };

  // Transport
  if (lower.includes('transport') || lower.includes('fuel') || lower.includes('uber') || lower.includes('taxi')) return {
    name: 'car',
    color: '#2196F3'
  };

  // Shopping
  if (lower.includes('shop') || lower.includes('amazon') || lower.includes('cloth')) return {
    name: 'cart',
    color: '#E91E63'
  };

  // Bills
  if (lower.includes('bill') || lower.includes('recharge') || lower.includes('wifi')) return {
    name: 'receipt',
    color: '#673AB7'
  };

  // Income
  if (lower.includes('salary') || lower.includes('profit')) return {
    name: 'cash',
    color: '#4CAF50'
  };

  // --- NEW CATEGORIES YOU REQUESTED ---

  // Investment
  if (lower.includes('invest') || lower.includes('stock') || lower.includes('mutual') || lower.includes('sip') || lower.includes('trade')) return {
    name: 'trending-up',
    color: '#009688'
  };

  // Insurance
  if (lower.includes('insurance') || lower.includes('lic') || lower.includes('premium') || lower.includes('policy')) return {
    name: 'shield-checkmark',
    color: '#3F51B5'
  };

  // Family & Home
  if (lower.includes('family') || lower.includes('home') || lower.includes('rent') || lower.includes('house') || lower.includes('kids')) return {
    name: 'home',
    color: '#795548'
  };

  // Gifts & Donation
  if (lower.includes('gift') || lower.includes('donate') || lower.includes('charity')) return {
    name: 'gift',
    color: '#FF5722'
  };

  // Default
  return {
    name: 'pricetag',
    color: '#607D8B'
  };
};

// 2. List of icons for User Selection (The "Picker")
export const AVAILABLE_ICONS = [{
  name: 'fast-food',
  color: '#FF9800'
},
// Food
{
  name: 'car',
  color: '#2196F3'
},
// Transport
{
  name: 'cart',
  color: '#E91E63'
},
// Shopping
{
  name: 'receipt',
  color: '#673AB7'
},
// Bills
{
  name: 'cash',
  color: '#4CAF50'
},
// Money
{
  name: 'trending-up',
  color: '#009688'
},
// Investment
{
  name: 'shield-checkmark',
  color: '#3F51B5'
},
// Insurance
{
  name: 'home',
  color: '#795548'
},
// Family/Home
{
  name: 'gift',
  color: '#FF5722'
},
// Gift
{
  name: 'medkit',
  color: '#F44336'
},
// Health
{
  name: 'school',
  color: '#FFC107'
},
// Education
{
  name: 'airplane',
  color: '#03A9F4'
},
// Travel
{
  name: 'game-controller',
  color: '#9C27B0'
},
// Entertainment
{
  name: 'construct',
  color: '#607D8B'
},
// Repair
{
  name: 'paw',
  color: '#795548'
},
// Pets
{
  name: 'fitness',
  color: '#000000'
} // Gym
];
