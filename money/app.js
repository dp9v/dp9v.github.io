(() => {
  "use strict";

  const model = globalThis.MoneyModel;
  const storageKey = "dp9v.money.v1";
  const get = id => document.getElementById(id);
  const workspace = get("workspace");
  const tabs = get("month-tabs");
  const monthForm = get("month-form");
  const jsonDialog = get("json-dialog");
  const jsonText = get("json-text");
  const transactionDrafts = new Map();
  const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  let data = { version: 1, months: [] };
  let selectedId = null;
  let storedRaw = null;
  let monthFormSnapshot = "";
  let jsonMode = null;
  let dialogSession = 0;

  const selectedMonth = () => data.months.find(month => month.id === selectedId);
  const orderedMonths = () => [...data.months].reverse().sort((a, b) => b.month.localeCompare(a.month));
  const money = amount => `${amount < 0 ? "−" : ""}${numberFormat.format(Math.floor(Math.abs(amount) / 100))}.${String(Math.abs(amount) % 100).padStart(2, "0")}`;
  const formValues = form => JSON.stringify([...form.elements]
    .filter(field => field.matches("input, select")).map(field => field.value));

  function canLeaveMonth() {
    return !selectedMonth() ||
      (formValues(monthForm) === monthFormSnapshot && transactionDrafts.size === 0) ||
      window.confirm("You have unsaved changes. Switch months and discard this input?");
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showError(message) {
    const error = get(jsonDialog.open ? "json-error" : "error");
    error.textContent = message;
    error.hidden = false;
    get("notice").hidden = true;
    get("json-notice").hidden = true;
  }

  function notify(message) {
    get("notice").textContent = message;
    get("notice").hidden = false;
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      const loaded = raw === null ? { version: 1, months: [] } : model.validate(JSON.parse(raw));
      data = loaded;
      storedRaw = raw;
    } catch (cause) {
      console.error("Unable to read money storage", cause);
      showError("Could not read saved months. Existing data has not been overwritten. Check browser storage access and reload the page.");
      workspace.disabled = true;
      return;
    }
    workspace.disabled = false;
    get("error").hidden = true;
    if (!selectedMonth()) selectedId = orderedMonths()[0]?.id ?? null;
    render();
  }

  function save(nextData, nextSelectedId = selectedId, { resetMonth = false, renderTransactions = true, clearDrafts = false } = {}) {
    let validated;
    let raw;
    try {
      validated = model.validate(nextData);
      raw = JSON.stringify(validated);
    } catch (cause) {
      showError(cause.message);
      return false;
    }
    try {
      // Refuse stale writes rather than replacing changes from another browser tab.
      if (localStorage.getItem(storageKey) !== storedRaw) {
        showError("Data changed in another browser tab. Reload the page before saving; your changes have not been saved.");
        return false;
      }
      localStorage.setItem(storageKey, raw);
    } catch (cause) {
      console.error("Unable to write money storage", cause);
      showError("Changes were not saved: browser storage is unavailable or full. Free up space or allow site storage, then try again.");
      return false;
    }
    const changedSelection = selectedId !== nextSelectedId;
    data = validated;
    storedRaw = raw;
    selectedId = nextSelectedId;
    if (changedSelection || clearDrafts) transactionDrafts.clear();
    get("error").hidden = true;
    get("json-error").hidden = true;
    get("notice").hidden = true;
    if (!resetMonth && !changedSelection && !renderTransactions) renderTotals();
    else render(resetMonth || changedSelection, renderTransactions || changedSelection);
    return true;
  }

  function updateMonth(nextMonth, resetForms) {
    return save({ version: 1, months: data.months.map(month => month.id === nextMonth.id ? nextMonth : month) }, selectedId, resetForms);
  }

  function selectMonth(id, focus = false) {
    if (id !== selectedId) {
      if (!canLeaveMonth()) return;
      selectedId = id;
      transactionDrafts.clear();
      render();
    }
    if (focus) tabs.querySelector('[aria-selected="true"]').focus();
  }

  function transactionNode(transaction) {
    const draft = transactionDrafts.get(transaction.id);
    const values = draft ?? { ...transaction, amount: model.amountInput(transaction.amount) };
    const item = element("li");
    item.dataset.transactionId = transaction.id;
    const row = element("form", `transaction ${values.status}`);
    const input = (name, label, type = "text") => {
      const field = element("input", `transaction-${name}`);
      field.name = name;
      field.type = type;
      field.value = values[name];
      field.required = true;
      field.setAttribute("aria-label", label);
      return field;
    };
    const title = input("title", "Transaction title");
    title.maxLength = 200;
    title.placeholder = "Title";
    title.autocomplete = "off";
    const amountGroup = element("div", "transaction-amount");
    const kind = element("select");
    kind.name = "kind";
    kind.setAttribute("aria-label", "Transaction type: expense or income");
    kind.title = "− expense, + income";
    for (const [value, text] of [["expense", "−"], ["income", "+"]]) {
      const option = element("option", "", text);
      option.value = value;
      kind.append(option);
    }
    kind.value = values.kind;
    const amount = input("amount", "Amount");
    amount.className = "transaction-value";
    amount.inputMode = "decimal";
    amount.maxLength = 16;
    amount.placeholder = "0.00";
    amountGroup.append(kind, amount);
    const date = input("date", "Expected date", "date");
    date.min = `${selectedMonth().month}-01`;
    date.max = `${selectedMonth().month}-${model.daysInMonth(selectedMonth().month)}`;
    const status = element("select", "transaction-status");
    status.name = "status";
    status.setAttribute("aria-label", "Transaction status");
    const updateStatusOptions = value => {
      status.replaceChildren();
      for (const [key, text] of [["pending", "Pending"], ["reserved", "Reserved"],
        ["paid", kind.value === "income" ? "Received" : "Paid"]]) {
        if (kind.value === "income" && key === "reserved") continue;
        const option = element("option", "", text);
        option.value = key;
        if (key === "reserved") option.title = "Set aside, not yet spent";
        status.append(option);
      }
      status.value = kind.value === "income" && value === "reserved" ? "pending" : value;
      amount.classList.toggle("income", kind.value === "income");
    };
    updateStatusOptions(values.status);
    const note = element("span", "row-note", "Not saved");
    note.id = `row-note-${model.id()}`;
    note.setAttribute("role", "status");
    note.hidden = !draft;
    for (const field of [title, kind, amount, date, status]) field.setAttribute("aria-describedby", note.id);
    const rememberDraft = () => {
      transactionDrafts.set(transaction.id, {
        id: transaction.id, title: title.value, amount: amount.value,
        date: date.value, kind: kind.value, status: status.value
      });
      note.textContent = "Not saved";
      note.hidden = false;
    };
    const commit = () => {
      rememberDraft();
      if (!row.checkValidity() || !title.value.trim()) {
        note.textContent = "Not saved: enter a title, amount and a date within this month.";
        return;
      }
      let value;
      try {
        value = model.parseAmount(amount.value);
      } catch (cause) {
        note.textContent = `Not saved: ${cause.message}`;
        return;
      }
      if (value <= 0) {
        note.textContent = "Not saved: the amount must be greater than zero. Use −/+ to choose the type.";
        return;
      }
      const next = { ...transactionDrafts.get(transaction.id), title: title.value.trim(), amount: value };
      const month = selectedMonth();
      const exists = month.transactions.some(entry => entry.id === transaction.id);
      if (updateMonth({
        ...month, transactions: exists
          ? month.transactions.map(entry => entry.id === transaction.id ? next : entry)
          : [...month.transactions, next]
      }, { renderTransactions: false })) {
        transactionDrafts.delete(transaction.id);
        title.value = next.title;
        amount.value = model.amountInput(next.amount);
        row.className = `transaction ${next.status}`;
        note.hidden = true;
      }
    };
    row.addEventListener("input", rememberDraft);
    row.addEventListener("change", event => {
      if (event.target === kind) updateStatusOptions(status.value);
      commit();
    });
    row.addEventListener("submit", event => {
      event.preventDefault();
      commit();
    });
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" && event.target.matches("input")) {
        event.preventDefault();
        commit();
      }
    });
    const remove = element("button", "secondary danger delete-transaction", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Delete transaction");
    remove.title = "Delete transaction";
    remove.addEventListener("click", () => {
      const month = selectedMonth();
      const existing = month.transactions.find(entry => entry.id === transaction.id);
      if (existing && !window.confirm(`Delete transaction "${existing.title}"?`)) return;
      if (!existing || updateMonth({
        ...month, transactions: month.transactions.filter(entry => entry.id !== transaction.id)
      }, { renderTransactions: false })) {
        transactionDrafts.delete(transaction.id);
        item.remove();
        get("empty-transactions").hidden = get("transactions").children.length > 0;
        get("add-transaction").focus();
      }
    });
    row.append(title, amountGroup, date, status, remove, note);
    item.append(row);
    return item;
  }

  function render(resetMonth = true, renderTransactions = true) {
    const months = orderedMonths();
    tabs.replaceChildren(...months.map((month, index) => {
      const tab = element("button", `month-${month.status}`, month.title);
      tab.type = "button";
      tab.id = `month-tab-${index}`;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(month.id === selectedId));
      tab.setAttribute("aria-controls", "month-panel");
      tab.setAttribute("aria-label", `${month.title}, ${month.month}, ${month.status}`);
      tab.title = month.status === "active" ? "Active month" : "Draft month";
      tab.tabIndex = month.id === selectedId ? 0 : -1;
      tab.append(element("span", "tab-date", month.month));
      tab.addEventListener("click", () => selectMonth(month.id, true));
      tab.addEventListener("keydown", event => {
        let nextIndex;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % months.length;
        else if (event.key === "ArrowLeft") nextIndex = (index - 1 + months.length) % months.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = months.length - 1;
        else return;
        event.preventDefault();
        selectMonth(months[nextIndex].id, true);
      });
      return tab;
    }));
    const month = selectedMonth();
    get("empty").hidden = Boolean(month);
    get("month-panel").hidden = !month;
    get("export").disabled = data.months.length === 0;
    get("clear-all").disabled = data.months.length === 0;
    if (!month) return;
    get("month-panel").setAttribute("aria-labelledby", tabs.querySelector('[aria-selected="true"]').id);
    if (resetMonth) {
      get("month-title").value = month.title;
      get("month-date").value = month.month;
      get("month-status").value = month.status;
      get("opening").value = model.amountInput(month.opening);
      monthFormSnapshot = formValues(monthForm);
    }
    if (renderTransactions) {
      const ids = new Set(month.transactions.map(transaction => transaction.id));
      const pending = [...transactionDrafts.values()].filter(transaction => !ids.has(transaction.id));
      get("transactions").replaceChildren(...[
        ...[...month.transactions].sort((a, b) => a.date.localeCompare(b.date)), ...pending
      ].map(transactionNode));
    }
    get("empty-transactions").hidden = get("transactions").children.length > 0;
    renderTotals();
  }

  function renderTotals() {
    for (const [name, value] of Object.entries(model.totals(selectedMonth()))) {
      const output = get(`total-${name}`);
      output.textContent = money(value);
      output.classList.toggle("negative", value < 0);
    }
  }

  monthForm.addEventListener("submit", event => {
    event.preventDefault();
    const month = selectedMonth();
    const title = get("month-title").value.trim();
    const date = get("month-date").value;
    if (!title || !model.validMonth(date)) {
      showError("Enter a title and a valid calendar month.");
      return;
    }
    let opening;
    try {
      opening = model.parseAmount(get("opening").value);
    } catch (cause) {
      showError(cause.message);
      return;
    }
    if (date !== month.month && transactionDrafts.size &&
        !window.confirm("Changing the month will discard unsaved row changes. Continue?")) return;
    if (updateMonth({
      ...month, title, month: date, status: get("month-status").value, opening,
      transactions: month.transactions.map(transaction => ({ ...transaction, date: model.moveDate(transaction.date, date) }))
    }, { resetMonth: true, clearDrafts: date !== month.month })) notify("Month settings saved.");
  });

  get("add-transaction").addEventListener("click", () => {
    const month = selectedMonth();
    const transaction = {
      id: model.id(), title: "", amount: "", date: `${month.month}-01`, kind: "expense", status: "pending"
    };
    transactionDrafts.set(transaction.id, transaction);
    const row = transactionNode(transaction);
    get("transactions").append(row);
    get("empty-transactions").hidden = true;
    row.querySelector("input").focus();
  });
  get("new-month").addEventListener("click", () => {
    if (!canLeaveMonth()) return;
    let month;
    try {
      month = model.createMonth(selectedMonth());
    } catch (cause) {
      showError(cause.message);
      return;
    }
    if (save({ version: 1, months: [...data.months, month] }, month.id)) {
      get("month-heading").focus();
      notify("Draft month created.");
    }
  });
  get("delete-month").addEventListener("click", () => {
    const month = selectedMonth();
    if (!window.confirm(`Delete month "${month.title}" and all its transactions? This cannot be undone without a backup.`)) return;
    const displayed = orderedMonths();
    const index = displayed.findIndex(item => item.id === month.id);
    const remaining = displayed.filter(item => item.id !== month.id);
    const months = data.months.filter(item => item.id !== month.id);
    if (save({ version: 1, months }, remaining[Math.min(index, remaining.length - 1)]?.id ?? null)) {
      (tabs.querySelector('[aria-selected="true"]') ?? get("new-month")).focus();
    }
  });
  get("clear-all").addEventListener("click", () => {
    if (!window.confirm("Clear all months, transactions and unsaved changes? This cannot be undone. Export a backup first.")) return;
    if (save({ version: 1, months: [] }, null, { clearDrafts: true })) {
      get("new-month").focus();
      notify("All months cleared.");
    }
  });

  function openJsonDialog(mode) {
    jsonMode = mode;
    dialogSession++;
    const exporting = mode === "export";
    get("json-heading").textContent = exporting ? "Export JSON" : "Import JSON";
    get("json-hint").hidden = exporting;
    jsonText.value = exporting ? JSON.stringify(data) : "";
    jsonText.readOnly = exporting;
    get("paste-json").hidden = exporting;
    get("copy-json").hidden = !exporting;
    get("import-json").hidden = exporting;
    get("paste-json").disabled = false;
    get("copy-json").disabled = false;
    get("import-json").disabled = false;
    get("json-error").hidden = true;
    get("json-notice").hidden = true;
    jsonDialog.showModal();
    jsonText.focus();
    if (exporting) jsonText.select();
  }

  function jsonNotice(message) {
    get("json-error").hidden = true;
    get("json-notice").textContent = message;
    get("json-notice").hidden = false;
  }

  get("close-json").addEventListener("click", () => jsonDialog.close());
  jsonText.addEventListener("input", () => {
    get("json-error").hidden = true;
    get("json-notice").hidden = true;
  });
  get("export").addEventListener("click", () => {
    if (transactionDrafts.size || (selectedMonth() && formValues(monthForm) !== monthFormSnapshot)) {
      showError("Save or discard your changes before exporting.");
      return;
    }
    openJsonDialog("export");
  });
  get("import").addEventListener("click", () => openJsonDialog("import"));

  get("copy-json").addEventListener("click", async () => {
    if (!navigator.clipboard?.writeText) {
      showError("Clipboard unavailable. Select the JSON and copy it manually.");
      jsonText.focus();
      jsonText.select();
      return;
    }
    const session = dialogSession;
    get("copy-json").disabled = true;
    try {
      await navigator.clipboard.writeText(jsonText.value);
      if (jsonDialog.open && session === dialogSession) jsonNotice("Copied.");
    } catch (cause) {
      console.error("Unable to copy money JSON", cause);
      if (jsonDialog.open && session === dialogSession) {
        showError("Could not copy. Select the JSON and copy it manually.");
        jsonText.focus();
        jsonText.select();
      }
    } finally {
      if (session === dialogSession) get("copy-json").disabled = false;
    }
  });

  get("paste-json").addEventListener("click", async () => {
    if (!navigator.clipboard?.readText) {
      showError("Clipboard unavailable. Paste JSON into the field manually.");
      jsonText.focus();
      return;
    }
    const session = dialogSession;
    const previousText = jsonText.value;
    get("paste-json").disabled = true;
    get("import-json").disabled = true;
    try {
      const text = await navigator.clipboard.readText();
      if (!jsonDialog.open || session !== dialogSession) return;
      if (jsonText.value !== previousText) {
        showError("The input changed while reading the clipboard. Paste again if needed.");
        return;
      }
      if (!text.trim()) {
        showError("The clipboard has no text.");
        return;
      }
      jsonText.value = text;
      get("json-error").hidden = true;
      get("json-notice").hidden = true;
      jsonText.focus();
    } catch (cause) {
      console.error("Unable to paste money JSON", cause);
      if (jsonDialog.open && session === dialogSession) {
        showError("Could not access the clipboard. Paste JSON into the field manually.");
        jsonText.focus();
      }
    } finally {
      if (session === dialogSession) {
        get("paste-json").disabled = false;
        get("import-json").disabled = workspace.disabled;
      }
    }
  });

  get("json-form").addEventListener("submit", event => {
    event.preventDefault();
    if (jsonMode !== "import") return;
    if (workspace.disabled) {
      showError("Reload the page before importing. Your saved data has changed or is unavailable.");
      return;
    }
    if (!jsonText.value.trim()) {
      showError("Paste JSON to import.");
      return;
    }
    let incoming;
    try {
      incoming = model.validate(JSON.parse(jsonText.value));
    } catch (cause) {
      showError(cause instanceof SyntaxError ? "Invalid JSON. Saved months are unchanged." : cause.message);
      return;
    }
    const result = model.merge(data, incoming);
    if (!result.added) {
      jsonNotice(`Nothing to add. Duplicates skipped: ${result.skipped}.`);
      return;
    }
    if (!window.confirm(`Add ${result.added} month(s), including ${result.conflicts} changed version(s)? Skip ${result.skipped} duplicate(s). Existing months stay unchanged.`)) return;
    if (!canLeaveMonth()) return;
    if (save(result.data, result.data.months.at(-1).id)) {
      jsonDialog.close();
      notify(`Added: ${result.added}. Changed versions: ${result.conflicts}. Duplicates skipped: ${result.skipped}.`);
    }
  });
  window.addEventListener("storage", event => {
    if (event.storageArea !== localStorage || (event.key !== storageKey && event.key !== null)) return;
    showError("Data changed in another browser tab. Reload the page to load the latest version. Unsaved input will be lost.");
    workspace.disabled = true;
    get("import-json").disabled = true;
  });
  window.addEventListener("beforeunload", event => {
    if (transactionDrafts.size || (selectedMonth() && formValues(monthForm) !== monthFormSnapshot)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  load();
})();
