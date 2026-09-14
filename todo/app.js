(() => {
  "use strict";

  const storageKey = "dp9v.todo.v1";
  const priorities = { high: "High", medium: "Medium", low: "Low" };
  const form = document.getElementById("task-form");
  const taskPanel = document.getElementById("task-panel");
  const toggleForm = document.getElementById("toggle-form");
  const fields = document.getElementById("form-fields");
  const title = document.getElementById("title");
  const description = document.getElementById("description");
  const category = document.getElementById("category");
  const priority = document.getElementById("priority");
  const filter = document.getElementById("filter");
  const list = document.getElementById("task-list");
  const error = document.getElementById("error");
  const cancelEdit = document.getElementById("cancel-edit");
  const expandedTasks = new Set();
  let tasks = [];
  let editingId = null;
  let drag = null;
  let scrollFrame = null;

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
  }

  function readTasks() {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return [];
    const data = JSON.parse(raw);
    const ids = new Set();
    if (!Array.isArray(data) || !data.every(task => {
      if (!task || typeof task.id !== "string" || !task.id || ids.has(task.id) ||
          typeof task.title !== "string" || !task.title.trim() ||
          typeof task.description !== "string" || typeof task.category !== "string" ||
          !Object.hasOwn(priorities, task.priority) || typeof task.completed !== "boolean") {
        return false;
      }
      ids.add(task.id);
      return true;
    })) {
      throw new Error("Invalid stored tasks");
    }
    return data;
  }

  function load() {
    clearDrag();
    try {
      tasks = readTasks();
    } catch (cause) {
      console.error("Unable to read todo storage", cause);
      showError("Could not read your tasks. Check browser storage access and reload the page. Existing data has not been overwritten.");
      fields.disabled = true;
      toggleForm.disabled = true;
      list.replaceChildren();
      document.getElementById("summary").textContent = "Storage unavailable";
      document.getElementById("empty").hidden = true;
      return;
    }
    fields.disabled = false;
    toggleForm.disabled = false;
    error.hidden = true;
    render();
  }

  function save(nextTasks) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextTasks));
    } catch (cause) {
      console.error("Unable to write todo storage", cause);
      showError("Changes were not saved. Browser storage is unavailable or full. Free up space or allow site storage, then try again.");
      return false;
    }
    tasks = nextTasks;
    error.hidden = true;
    render();
    return true;
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function updateSuggestions() {
    const categoryOptions = [...new Set(tasks.map(task => task.category).filter(Boolean))];
    document.getElementById("categories").replaceChildren(
      ...categoryOptions.sort((a, b) => a.localeCompare(b, "en")).map(value => {
        const option = document.createElement("option");
        option.value = value;
        return option;
      })
    );
  }

  function setFormOpen(open) {
    taskPanel.hidden = !open;
    toggleForm.setAttribute("aria-expanded", String(open));
    toggleForm.textContent = open ? "Hide form" : editingId ? "Continue editing" : "New task";
    if (open) title.focus();
    else toggleForm.focus();
  }

  function resetForm() {
    editingId = null;
    form.reset();
    title.setCustomValidity("");
    document.getElementById("form-heading").textContent = "New task";
    document.getElementById("save-button").textContent = "Add task";
    cancelEdit.hidden = true;
    toggleForm.textContent = taskPanel.hidden ? "New task" : "Hide form";
    updateSuggestions();
  }

  function editTask(task) {
    editingId = task.id;
    title.value = task.title;
    title.setCustomValidity("");
    description.value = task.description;
    category.value = task.category;
    priority.value = task.priority;
    document.getElementById("form-heading").textContent = "Edit task";
    document.getElementById("save-button").textContent = "Save";
    cancelEdit.hidden = false;
    updateSuggestions();
    setFormOpen(true);
    form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function taskNode(task, index) {
    const item = element("li", `task${task.completed ? " completed" : ""}`);
    const row = element("div", "task-row");
    const handle = element("button", "secondary task-drag");
    handle.type = "button";
    handle.setAttribute("aria-label", `Reorder: ${task.title}`);
    handle.setAttribute("aria-describedby", "reorder-help");
    handle.title = "Drag to reorder, or use the Up and Down arrow keys";
    const grip = element("span", "grip");
    grip.setAttribute("aria-hidden", "true");
    handle.append(grip);
    const checkLabel = element("label", "task-check");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.completed;
    checkbox.setAttribute("aria-label", `${task.completed ? "Mark as active" : "Mark as completed"}: ${task.title}`);
    checkbox.addEventListener("change", () => {
      if (!save(tasks.map(current => current.id === task.id
        ? { ...current, completed: checkbox.checked } : current))) {
        checkbox.checked = task.completed;
      } else {
        restoreTaskFocus(task.id);
      }
    });
    checkLabel.append(checkbox);

    const taskTitle = element("strong", "task-title", task.title);
    taskTitle.title = task.title;
    const taskCategory = element("span", "task-category", task.category || "Uncategorized");
    taskCategory.title = task.category || "Uncategorized";
    const taskPriority = element("span", `badge priority-${task.priority}`, priorities[task.priority]);
    taskPriority.setAttribute("aria-label", `${priorities[task.priority]} priority`);

    const actions = element("div", "task-actions");
    const edit = element("button", "secondary", "Edit");
    edit.type = "button";
    edit.setAttribute("aria-label", `Edit: ${task.title}`);
    edit.addEventListener("click", () => editTask(task));
    const remove = element("button", "secondary danger", "Delete");
    remove.type = "button";
    remove.setAttribute("aria-label", `Delete: ${task.title}`);
    remove.addEventListener("click", () => {
      if (!window.confirm(`Delete task "${task.title}"?`)) return;
      if (save(tasks.filter(current => current.id !== task.id))) {
        if (editingId === task.id) resetForm();
        filter.focus();
      }
    });
    actions.append(edit, remove);

    const toggle = element("button", "secondary task-toggle");
    toggle.type = "button";
    const arrow = element("span", "chevron");
    arrow.setAttribute("aria-hidden", "true");
    toggle.append(arrow);
    toggle.disabled = !task.description;
    if (task.description) {
      const details = element("p", "task-description", task.description);
      details.id = `task-description-${index}`;
      toggle.setAttribute("aria-controls", details.id);
      const updateExpanded = () => {
        const expanded = expandedTasks.has(task.id);
        details.hidden = !expanded;
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.setAttribute("aria-label", `${expanded ? "Hide" : "Show"} description: ${task.title}`);
        toggle.title = expanded ? "Hide description" : "Show description";
      };
      toggle.addEventListener("click", () => {
        if (expandedTasks.has(task.id)) expandedTasks.delete(task.id);
        else expandedTasks.add(task.id);
        updateExpanded();
      });
      updateExpanded();
      item.append(row, details);
    } else {
      toggle.setAttribute("aria-label", `No description: ${task.title}`);
      toggle.title = "No description";
      item.append(row);
    }
    item.dataset.id = task.id;
    row.append(handle, checkLabel, taskTitle, taskCategory, taskPriority, actions, toggle);
    return item;
  }

  function restoreTaskFocus(id, selector = "input") {
    const item = [...list.querySelectorAll(".task")].find(node => node.dataset.id === id);
    if (item) item.querySelector(selector).focus({ preventScroll: true });
    else filter.focus();
  }

  function clearDrag() {
    const current = drag;
    drag = null;
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
    list.classList.remove("is-reordering");
    for (const group of list.querySelectorAll(".drop-target")) group.classList.remove("drop-target");
    if (current) {
      current.item.classList.remove("dragging");
      if (list.hasPointerCapture(current.pointerId)) list.releasePointerCapture(current.pointerId);
    }
    return current;
  }

  function saveOrder(id) {
    const byId = new Map(tasks.map(task => [task.id, task]));
    const orderedTasks = [...list.querySelectorAll(".task")].map(item => ({
      ...byId.get(item.dataset.id),
      category: item.closest(".task-group").dataset.category
    }));
    const visibleIds = new Set(orderedTasks.map(task => task.id));
    let index = 0;
    // Only replace visible slots so filtered-out tasks keep their positions.
    const nextTasks = tasks.map(task => visibleIds.has(task.id) ? orderedTasks[index++] : task);
    const changed = nextTasks.some((task, position) =>
      task.id !== tasks[position].id || task.category !== tasks[position].category);
    if (!changed || !save(nextTasks)) {
      render();
    } else {
      const moved = orderedTasks.find(task => task.id === id);
      const groupOrder = orderedTasks.filter(task => task.category === moved.category).map(task => task.id);
      if (editingId === id && category.value.trim() === byId.get(id).category) {
        category.value = moved.category;
      }
      document.getElementById("reorder-status").textContent =
        `Moved "${moved.title}" to ${moved.category || "Uncategorized"}, position ${groupOrder.indexOf(id) + 1} of ${groupOrder.length}. Changes saved.`;
    }
    restoreTaskFocus(id, ".task-drag");
  }

  function finishDrag(commit) {
    const current = clearDrag();
    if (!current) return;
    if (current.active && commit) {
      saveOrder(current.item.dataset.id);
    } else {
      if (current.active) render();
      restoreTaskFocus(current.item.dataset.id, ".task-drag");
    }
  }

  function moveTaskNode(item, parent, next) {
    const source = item.closest(".task-group");
    const target = parent.closest(".task-group");
    parent.insertBefore(item, next);
    const name = target.dataset.category || "Uncategorized";
    const label = item.querySelector(".task-category");
    label.textContent = name;
    label.title = name;
    for (const group of new Set([source, target])) {
      group.querySelector(".group-empty").hidden = Boolean(group.querySelector(".task"));
    }
    item.querySelector(".task-drag").focus({ preventScroll: true });
  }

  function updateDragPosition() {
    const groups = [...list.querySelectorAll(".task-group")];
    const target = groups.find((group, index) => {
      const nextGroup = groups[index + 1];
      return !nextGroup || drag.y < nextGroup.getBoundingClientRect().top - 8;
    });
    for (const group of groups) group.classList.toggle("drop-target", group === target);
    const parent = target.querySelector(".tasks");
    const siblings = [...parent.querySelectorAll(".task")].filter(item => item !== drag.item);
    const next = siblings.find(item => {
      const bounds = item.getBoundingClientRect();
      return drag.y < bounds.top + bounds.height / 2;
    });
    if (drag.item.parentElement !== parent || drag.item.nextElementSibling !== (next || null)) {
      moveTaskNode(drag.item, parent, next || null);
    }
  }

  function scrollDuringDrag() {
    if (!drag?.active) return;
    const edge = 64;
    const speed = drag.y < edge ? -12 : drag.y > window.innerHeight - edge ? 12 : 0;
    if (speed) {
      window.scrollBy(0, speed);
      updateDragPosition();
    }
    scrollFrame = requestAnimationFrame(scrollDuringDrag);
  }

  function render() {
    clearDrag();
    const completed = tasks.filter(task => task.completed).length;
    document.getElementById("summary").textContent =
      `Total: ${tasks.length} · Active: ${tasks.length - completed} · Completed: ${completed}`;
    const visible = tasks.filter(task => filter.value === "all" ||
      (filter.value === "completed" ? task.completed : !task.completed));

    const describedIds = new Set(tasks.filter(task => task.description).map(task => task.id));
    for (const id of expandedTasks) {
      if (!describedIds.has(id)) expandedTasks.delete(id);
    }
    const groups = new Map(tasks.map(task => [task.category, []]));
    for (const task of visible) groups.get(task.category).push(task);
    let taskIndex = 0;
    list.replaceChildren(...[...groups].sort(([a], [b]) => a.localeCompare(b, "en")).map(([name, groupedTasks], groupIndex) => {
      const group = element("section", "task-group");
      group.dataset.category = name;
      const heading = element("h3", "group-heading", name || "Uncategorized");
      heading.id = `category-heading-${groupIndex}`;
      group.setAttribute("aria-labelledby", heading.id);
      const emptyGroup = element("p", "group-empty", "No tasks with this status. Drop a task here to move it into this category.");
      emptyGroup.hidden = groupedTasks.length > 0;
      const taskList = element("ul", "tasks");
      taskList.append(...groupedTasks.map(task => taskNode(task, taskIndex++)));
      group.append(heading, taskList, emptyGroup);
      return group;
    }));
    list.hidden = visible.length === 0;
    const empty = document.getElementById("empty");
    empty.hidden = visible.length > 0;
    empty.textContent = tasks.length
      ? "No tasks with this status."
      : 'No tasks yet. Click "New task" to get started.';
    updateSuggestions();
  }

  list.addEventListener("pointerdown", event => {
    const handle = event.target.closest(".task-drag");
    if (!handle || fields.disabled || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = {
      pointerId: event.pointerId,
      item: handle.closest(".task"),
      startY: event.clientY,
      y: event.clientY,
      active: false
    };
    list.setPointerCapture(event.pointerId);
  });
  list.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.y = event.clientY;
    if (!drag.active && Math.abs(drag.y - drag.startY) < 5) return;
    if (!drag.active) {
      drag.active = true;
      drag.item.classList.add("dragging");
      list.classList.add("is-reordering");
      scrollFrame = requestAnimationFrame(scrollDuringDrag);
    }
    updateDragPosition();
  });
  list.addEventListener("pointerup", event => {
    if (drag && event.pointerId === drag.pointerId) finishDrag(true);
  });
  for (const eventName of ["pointercancel", "lostpointercapture"]) {
    list.addEventListener(eventName, event => {
      if (drag && event.pointerId === drag.pointerId) finishDrag(false);
    });
  }
  list.addEventListener("keydown", event => {
    if (drag && event.key === "Escape") {
      event.preventDefault();
      finishDrag(false);
      return;
    }
    const handle = event.target.closest(".task-drag");
    if (!handle || drag || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const item = handle.closest(".task");
    const up = event.key === "ArrowUp";
    const neighbor = up ? item.previousElementSibling : item.nextElementSibling;
    if (neighbor) {
      moveTaskNode(item, item.parentElement, up ? neighbor : neighbor.nextElementSibling);
    } else {
      const group = item.closest(".task-group");
      const nextGroup = up ? group.previousElementSibling : group.nextElementSibling;
      if (!nextGroup) return;
      const parent = nextGroup.querySelector(".tasks");
      moveTaskNode(item, parent, up ? null : parent.firstElementChild);
    }
    saveOrder(item.dataset.id);
  });
  window.addEventListener("blur", () => finishDrag(false));
  toggleForm.addEventListener("click", () => setFormOpen(taskPanel.hidden));
  title.addEventListener("input", () => title.setCustomValidity(""));
  filter.addEventListener("change", () => {
    if (!fields.disabled) render();
  });
  cancelEdit.addEventListener("click", () => {
    resetForm();
    setFormOpen(false);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!title.value.trim()) {
      title.setCustomValidity("Enter a task title.");
      title.reportValidity();
      return;
    }
    if (fields.disabled || !form.reportValidity()) return;
    if (editingId && !tasks.some(task => task.id === editingId)) {
      showError("This task was deleted in another tab. Cancel editing to create a new task.");
      return;
    }
    const values = {
      title: title.value.trim(),
      description: description.value.trim(),
      category: category.value.trim(),
      priority: priority.value
    };
    const nextTasks = editingId
      ? tasks.map(task => task.id === editingId ? { ...task, ...values } : task)
      : [...tasks, { id: crypto.randomUUID(), ...values, completed: false }];
    if (save(nextTasks)) {
      resetForm();
      setFormOpen(false);
    }
  });
  window.addEventListener("storage", event => {
    if (event.key === storageKey || event.key === null) load();
  });
  load();
})();
