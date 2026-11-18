// utils/LoanCalculator.js

export const calculateOutstandingBalance = (loan) => {
  // If missing critical data, return current stored balance
  if (!loan.startDate || !loan.emiAmount || !loan.originalAmount) return parseFloat(loan.balance);

  const principal = parseFloat(loan.originalAmount);
  const emi = parseFloat(loan.emiAmount);
  const rate = parseFloat(loan.interestRate || 0);

  const start = new Date(loan.startDate);
  const now = new Date();

  // Calculate months passed
  const monthsPassed = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());

  // If loan hasn't started or just started, return principal
  if (monthsPassed <= 0) return principal;

  let outstanding = principal;

  // --- 1. NO COST EMI ---
  // Simple: Principal - (EMI * Months)
  if (loan.loanType === 'No Cost EMI') {
    outstanding = principal - emi * monthsPassed;
  }

  // --- 2. FLAT RATE ---
  // Logic: Total Amount Payable = Principal + (Principal * Rate * Years)
  // Outstanding = Total Payable - (EMI * Months)
  else if (loan.loanType === 'Flat Rate') {
    const tenureMonths = loan.tenure || 12; // Avoid divide by zero
    const totalInterest = principal * (rate / 100) * (tenureMonths / 12);
    const totalPayable = principal + totalInterest;
    const totalPaid = emi * monthsPassed;
    outstanding = totalPayable - totalPaid;
  }

  // --- 3. REDUCING BALANCE (Standard Home/Car Loan) ---
  // We simulate the loan month by month
  else {
    let currentBal = principal;
    const monthlyRate = rate / 12 / 100; // e.g., 8.5% => 0.00708

    for (let i = 0; i < monthsPassed; i++) {
      if (currentBal <= 0) break;
      const interestForMonth = currentBal * monthlyRate;
      const principalComponent = emi - interestForMonth;
      currentBal = currentBal - principalComponent;
    }
    outstanding = currentBal;
  }

  // Balance cannot be negative (Loan paid off)
  return Math.max(0, outstanding);
};
