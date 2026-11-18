import * as Clipboard from 'expo-clipboard';
import { extractAmount, detectDirection } from '../utils/TransactionParser';

export const parseSmsFromClipboard = async () => {
  // 1. Get text from clipboard
  const text = await Clipboard.getStringAsync();
  if (!text) return null;

  // 2. FIND AMOUNT ("Rs. 1,200", "INR 500.00", "₹500"); skips balance amounts
  const amountValue = extractAmount(text);

  // 3. DETERMINE TYPE (Income vs Expense): earliest direction word wins
  const isCredit = detectDirection(text) === 'income';

  // 4. GUESS CATEGORY based on keywords
  let category = 'Other';
  const lowerText = text.toLowerCase();

  if (
    lowerText.includes('swiggy') ||
    lowerText.includes('zomato') ||
    lowerText.includes('food') ||
    lowerText.includes('restaurant')
  ) {
    category = 'Food';
  } else if (
    lowerText.includes('uber') ||
    lowerText.includes('ola') ||
    lowerText.includes('fuel') ||
    lowerText.includes('petrol')
  ) {
    category = 'Transport';
  } else if (lowerText.includes('amazon') || lowerText.includes('flipkart') || lowerText.includes('myntra')) {
    category = 'Shopping';
  } else if (
    lowerText.includes('jio') ||
    lowerText.includes('airtel') ||
    lowerText.includes('bill') ||
    lowerText.includes('netflix')
  ) {
    category = 'Bills';
  } else if (lowerText.includes('upi') || lowerText.includes('transfer')) {
    category = 'Transfer';
  }

  // 5. Return the result if an amount was found
  if (amountValue !== null) {
    return {
      amount: String(amountValue),
      type: isCredit ? 'income' : 'expense',
      category: category,
      originalText: text,
    };
  }

  return null;
};
