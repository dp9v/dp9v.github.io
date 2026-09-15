(() => {
  "use strict";

  const maxAmount = 99999999999999;
  const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const isAmount = value => Number.isSafeInteger(value) && Math.abs(value) <= maxAmount;
  const id = () => crypto.randomUUID();

  function validMonth(value) {
    return typeof value === "string" && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
  }

  function daysInMonth(month) {
    const [year, number] = month.split("-").map(Number);
    if (number === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
    return [4, 6, 9, 11].includes(number) ? 30 : 31;
  }

  function validDate(value, month) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      value.slice(0, 7) === month && Number(value.slice(8)) >= 1 && Number(value.slice(8)) <= daysInMonth(month);
  }

  function moveDate(date, month) {
    return `${month}-${String(Math.min(Number(date.slice(8)), daysInMonth(month))).padStart(2, "0")}`;
  }

  function parseAmount(value) {
    const normalized = value.trim().replace(",", ".");
    if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
      throw new Error("Enter a number with no more than two decimal places.");
    }
    const [whole, fraction = ""] = normalized.replace("-", "").split(".");
    const amount = (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) * (normalized.startsWith("-") ? -1 : 1);
    if (!isAmount(amount)) throw new Error("Amount is too large. Maximum: 999,999,999,999.99.");
    return amount;
  }

  function amountInput(amount) {
    return `${amount < 0 ? "-" : ""}${Math.floor(Math.abs(amount) / 100)}.${String(Math.abs(amount) % 100).padStart(2, "0")}`;
  }

  function totals(month) {
    let income = 0;
    let expense = 0;
    let current = month.opening;
    let reserved = 0;
    for (const transaction of month.transactions) {
      if (transaction.kind === "income") income += transaction.amount;
      else expense += transaction.amount;
      if (transaction.status === "paid") current += transaction.kind === "income" ? transaction.amount : -transaction.amount;
      if (transaction.status === "reserved") reserved += transaction.amount;
      if (![income, expense, current, reserved].every(Number.isSafeInteger)) {
        throw new Error("Transaction totals exceed the safe calculation range.");
      }
    }
    const closing = month.opening + income - expense;
    const available = current - reserved;
    if (![month.opening + income, closing, available].every(Number.isSafeInteger)) {
      throw new Error("The monthly balance exceeds the safe calculation range.");
    }
    return { opening: month.opening, income, expense, current, reserved, available, closing };
  }

  // Reconstruct only known fields: imported objects never become application state directly.
  function validate(data) {
    if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.months)) {
      throw new Error("Invalid JSON format. Use a version 1 money planner export.");
    }
    const monthIds = new Set();
    const months = data.months.map(month => {
      if (!isRecord(month) || !isText(month.id, 100) || monthIds.has(month.id) ||
          !isText(month.title, 100) || !validMonth(month.month) ||
          !["draft", "active"].includes(month.status) || !isAmount(month.opening) ||
          !Array.isArray(month.transactions)) {
        throw new Error("Invalid month or duplicate month ID.");
      }
      monthIds.add(month.id);
      const transactionIds = new Set();
      const transactions = month.transactions.map(transaction => {
        if (!isRecord(transaction) || !isText(transaction.id, 100) || transactionIds.has(transaction.id) ||
            !isText(transaction.title, 200) || !validDate(transaction.date, month.month) ||
            !["income", "expense"].includes(transaction.kind) || !isAmount(transaction.amount) || transaction.amount <= 0 ||
            !["pending", "reserved", "paid"].includes(transaction.status) ||
            (transaction.kind === "income" && transaction.status === "reserved")) {
          throw new Error("Invalid transaction: check the date, amount, type and status.");
        }
        transactionIds.add(transaction.id);
        return {
          id: transaction.id, title: transaction.title, date: transaction.date,
          kind: transaction.kind, amount: transaction.amount, status: transaction.status
        };
      });
      const result = {
        id: month.id, title: month.title, month: month.month,
        status: month.status, opening: month.opening, transactions
      };
      totals(result);
      return result;
    });
    return { version: 1, months };
  }

  function createMonth(previous, today = new Date()) {
    let month;
    if (previous) {
      let [year, number] = previous.month.split("-").map(Number);
      if (++number === 13) { year++; number = 1; }
      month = `${String(year).padStart(4, "0")}-${String(number).padStart(2, "0")}`;
    } else {
      month = `${String(today.getFullYear()).padStart(4, "0")}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    }
    if (!validMonth(month)) throw new Error("Cannot create a month outside the years 0001–9999.");
    const opening = previous ? totals(previous).closing : 0;
    if (!isAmount(opening)) throw new Error("The projection is too large for the new month's opening balance.");
    const date = new Date(`${month}-01T12:00:00`);
    return {
      id: id(),
      title: date.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      month, status: "draft", opening,
      transactions: previous ? previous.transactions.map(transaction => ({
        ...transaction, id: id(), date: moveDate(transaction.date, month), status: "pending"
      })) : []
    };
  }

  function merge(existing, incoming) {
    // Ignore the month ID so reimporting a conflict copy remains idempotent.
    const fingerprint = month => JSON.stringify({ ...month, id: "" });
    const fingerprints = new Set(existing.months.map(fingerprint));
    const ids = new Set(existing.months.map(month => month.id));
    const months = [...existing.months];
    let skipped = 0;
    let conflicts = 0;
    for (const month of incoming.months) {
      const signature = fingerprint(month);
      if (fingerprints.has(signature)) { skipped++; continue; }
      let next = month;
      if (ids.has(month.id)) {
        next = { ...month, id: id() };
        conflicts++;
      }
      ids.add(next.id);
      fingerprints.add(signature);
      months.push(next);
    }
    return { data: { version: 1, months }, added: months.length - existing.months.length, skipped, conflicts };
  }

  globalThis.MoneyModel = Object.freeze({
    id, validMonth, daysInMonth, moveDate, parseAmount, amountInput, totals, validate, createMonth, merge
  });
})();
