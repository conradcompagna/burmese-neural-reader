import { showCreateForm, togglePanel } from './dictionary-search.mjs';
import { dictionarySearchState } from './dictionary-search.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { escapeHtml } from './text.mjs';
export function showCustomEntries() {
  togglePanel(true);
  var html =
    '' +
    '<div class="userdict-list">' +
    '  <div class="userdict-list-header">' +
    '    <div style="font-size:13px;font-weight:600;">Custom Entries</div>' +
    '    <div class="userdict-list-controls">' +
    '      <select id="userdict-filter" class="userdict-filter">' +
    '        <option value="all">All</option>' +
    '        <option value="dict">Dictionary entries</option>' +
    '        <option value="rule">Normalization rules</option>' +
    '      </select>' +
    '    </div>' +
    '  </div>' +
    '  <div class="userdict-list-body" id="userdict-list-body"></div>' +
    '</div>';
  readerState.panelContent.innerHTML = html;
  var filterEl = document.getElementById('userdict-filter');
  if (filterEl) {
    filterEl.value = dictionarySearchState.customEntriesFilter;
    filterEl.addEventListener('change', function () {
      dictionarySearchState.customEntriesFilter = this.value;
      renderCustomEntries();
    });
  }
  loadCustomEntries();
}
export function loadCustomEntries() {
  var body = document.getElementById('userdict-list-body');
  if (body) {
    body.innerHTML = '<div class="userdict-empty">Loading...</div>';
  }
  fetch('/api/custom_entries/list')
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.ok) {
        if (body) {
          body.innerHTML = '<div class="userdict-empty">Failed to load entries.</div>';
        }
        return;
      }
      dictionarySearchState.customEntriesCache = Array.isArray(data.entries) ? data.entries : [];
      renderCustomEntries();
    })
    .catch(function (err) {
      console.error('Failed to load custom entries:', err);
      if (body) {
        body.innerHTML = '<div class="userdict-empty">Failed to load entries.</div>';
      }
    });
}
export function renderCustomEntries() {
  var body = document.getElementById('userdict-list-body');
  if (!body) return;
  var list = dictionarySearchState.customEntriesCache.filter(function (entry) {
    if (dictionarySearchState.customEntriesFilter === 'all') return true;
    return entry.type === dictionarySearchState.customEntriesFilter;
  });
  if (!list.length) {
    body.innerHTML = '<div class="userdict-empty">No entries found.</div>';
    return;
  }
  var html = '';
  list.forEach(function (entry) {
    if (entry.type === 'dict') {
      html +=
        '' +
        '<div class="userdict-item" data-type="dict" data-id="' +
        entry.id +
        '">' +
        '  <div class="userdict-item-header">' +
        '    <div class="userdict-item-title">Dictionary entry</div>' +
        '    <div class="userdict-item-actions">' +
        '      <button type="button" class="userdict-edit-btn">Edit</button>' +
        '      <button type="button" class="userdict-save-btn" style="display:none;">Save</button>' +
        '      <button type="button" class="userdict-cancel-btn" style="display:none;">Cancel</button>' +
        '      <button type="button" class="userdict-delete-btn danger">Delete</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="userdict-fields">' +
        '    <label>Headword</label>' +
        '    <input type="text" class="userdict-input" data-field="headword" value="' +
        escapeHtml(entry.headword || '') +
        '" disabled>' +
        '    <label>Pronunciation</label>' +
        '    <input type="text" class="userdict-input" data-field="romanization" value="' +
        escapeHtml(entry.romanization || '') +
        '" disabled>' +
        '    <label>POS</label>' +
        '    <input type="text" class="userdict-input" data-field="pos" value="' +
        escapeHtml(entry.pos || '') +
        '" disabled>' +
        '    <label>Definition</label>' +
        '    <textarea class="userdict-input userdict-textarea" data-field="definition" rows="2" disabled>' +
        escapeHtml(entry.definition || '') +
        '</textarea>' +
        '  </div>' +
        '</div>';
    } else if (entry.type === 'rule') {
      html +=
        '' +
        '<div class="userdict-item" data-type="rule" data-id="' +
        entry.id +
        '">' +
        '  <div class="userdict-item-header">' +
        '    <div class="userdict-item-title">Normalization rule</div>' +
        '    <div class="userdict-item-actions">' +
        '      <button type="button" class="userdict-edit-btn">Edit</button>' +
        '      <button type="button" class="userdict-save-btn" style="display:none;">Save</button>' +
        '      <button type="button" class="userdict-cancel-btn" style="display:none;">Cancel</button>' +
        '      <button type="button" class="userdict-delete-btn danger">Delete</button>' +
        '    </div>' +
        '  </div>' +
        '  <div class="userdict-fields">' +
        '    <label>Raw</label>' +
        '    <input type="text" class="userdict-input" data-field="raw" value="' +
        escapeHtml(entry.raw || '') +
        '" disabled>' +
        '    <label>Normalized</label>' +
        '    <input type="text" class="userdict-input" data-field="normalized" value="' +
        escapeHtml(entry.normalized || '') +
        '" disabled>' +
        '  </div>' +
        '</div>';
    }
  });
  body.innerHTML = html;
  bindCustomEntryActions(body);
}
export function setCustomEntryEditing(item, editing) {
  var inputs = item.querySelectorAll('.userdict-input');
  inputs.forEach(function (input) {
    input.disabled = !editing;
  });
  var editBtn = item.querySelector('.userdict-edit-btn');
  var saveBtn = item.querySelector('.userdict-save-btn');
  var cancelBtn = item.querySelector('.userdict-cancel-btn');
  if (editBtn) editBtn.style.display = editing ? 'none' : 'inline-block';
  if (saveBtn) saveBtn.style.display = editing ? 'inline-block' : 'none';
  if (cancelBtn) cancelBtn.style.display = editing ? 'inline-block' : 'none';
}
export function bindCustomEntryActions(container) {
  var items = container.querySelectorAll('.userdict-item');
  items.forEach(function (item) {
    var inputs = item.querySelectorAll('.userdict-input');
    inputs.forEach(function (input) {
      if (input.dataset.orig === undefined) {
        input.dataset.orig = input.value || '';
      }
    });
    var editBtn = item.querySelector('.userdict-edit-btn');
    var saveBtn = item.querySelector('.userdict-save-btn');
    var cancelBtn = item.querySelector('.userdict-cancel-btn');
    var deleteBtn = item.querySelector('.userdict-delete-btn');
    var entryType = item.getAttribute('data-type');
    var entryId = parseInt(item.getAttribute('data-id') || '-1', 10);
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        setCustomEntryEditing(item, true);
      });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        inputs.forEach(function (input) {
          input.value = input.dataset.orig || '';
        });
        setCustomEntryEditing(item, false);
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var payload = {
          id: entryId
        };
        if (entryType === 'dict') {
          inputs.forEach(function (input) {
            payload[input.dataset.field] = (input.value || '').trim();
          });
          fetch('/api/user_dict/update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          })
            .then(function (resp) {
              return resp.json();
            })
            .then(function (data) {
              if (!data || !data.ok) {
                alert(data && data.error ? data.error : 'Failed to update entry.');
                return;
              }
              loadCustomEntries();
            })
            .catch(function (err) {
              console.error('Failed to update entry:', err);
              alert('Failed to update entry.');
            });
        } else if (entryType === 'rule') {
          inputs.forEach(function (input) {
            payload[input.dataset.field] = (input.value || '').trim();
          });
          fetch('/api/text_override/update', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          })
            .then(function (resp) {
              return resp.json();
            })
            .then(function (data) {
              if (!data || !data.ok) {
                alert(data && data.error ? data.error : 'Failed to update rule.');
                return;
              }
              loadCustomEntries();
            })
            .catch(function (err) {
              console.error('Failed to update rule:', err);
              alert('Failed to update rule.');
            });
        }
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        var label = entryType === 'dict' ? 'dictionary entry' : 'normalization rule';
        if (!confirm('Delete this ' + label + '?')) return;
        var url = entryType === 'dict' ? '/api/user_dict/delete' : '/api/text_override/delete';
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            id: entryId
          })
        })
          .then(function (resp) {
            return resp.json();
          })
          .then(function (data) {
            if (!data || !data.ok) {
              alert(data && data.error ? data.error : 'Failed to delete entry.');
              return;
            }
            loadCustomEntries();
          })
          .catch(function (err) {
            console.error('Failed to delete entry:', err);
            alert('Failed to delete entry.');
          });
      });
    }
  });
}
export function initializeCustomEntries() {
  if (readerState.createBtn) {
    readerState.createBtn.addEventListener('click', function () {
      // Blank form as requested
      showCreateForm();
    });
  }
  if (readerState.viewBtn) {
    readerState.viewBtn.addEventListener('click', function () {
      showCustomEntries();
    });
  }
  // File handling
  return true;
}
