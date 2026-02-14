// src/config/adapters/moveposition.js
// MovePosition Protocol - Lending & Borrowing on Movement Network
// Contract: 0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf

export const movePositionAdapter = [
  {
    id: "moveposition_supply",
    name: "MovePosition Supply",
    type: "Lending",
    
    // MovePosition uses lend module for user positions
    searchString: "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::lend::",
    
    parse: (data) => {
      try {
        let depositBalance = 0;

        // deposit_notes stores the user's supply position
        if (data.deposit_notes !== undefined) {
          if (typeof data.deposit_notes === 'object') {
            depositBalance = Number(data.deposit_notes.value || data.deposit_notes.amount || 0);
          } else {
            depositBalance = Number(data.deposit_notes);
          }
        }
        
        // Check for alternative field names
        if (depositBalance === 0) {
          depositBalance = Number(
            data.deposited || 
            data.supply_amount || 
            data.principal || 
            data.balance?.value || 
            0
          );
        }

        if (depositBalance <= 0) return "0";

        return (depositBalance / 100000000).toFixed(4);
      } catch (e) {
        console.warn("Error parsing MovePosition supply:", e);
        return "0";
      }
    }
  },

  {
    id: "moveposition_borrow",
    name: "MovePosition Borrow",
    type: "Debt",
    
    searchString: "0xccd2621d2897d407e06d18e6ebe3be0e6d9b61f1e809dd49360522b9105812cf::lend::",
    
    parse: (data) => {
      try {
        let borrowBalance = 0;

        // loan_notes stores the user's borrow position
        if (data.loan_notes !== undefined) {
          if (typeof data.loan_notes === 'object') {
            borrowBalance = Number(data.loan_notes.value || data.loan_notes.amount || 0);
          } else {
            borrowBalance = Number(data.loan_notes);
          }
        }
        
        // Check alternative field names
        if (borrowBalance === 0) {
          borrowBalance = Number(
            data.borrowed ||
            data.debt_amount ||
            data.liability ||
            0
          );
        }

        if (borrowBalance <= 0) return "0";

        return (borrowBalance / 100000000).toFixed(4);
      } catch (e) {
        console.warn("Error parsing MovePosition borrow:", e);
        return "0";
      }
    }
  }
];