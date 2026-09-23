import { lookupAndDisplay } from './dictionary-panel.mjs';
import { dictionarySearchState } from './dictionary-search.state.mjs';
import { readerState } from './reader-state.state.mjs';
export // Panel toggle
function togglePanel(open) {
  readerState.panelOpen = open !== undefined ? open : !readerState.panelOpen;
  readerState.sidePanel.classList.toggle('open', readerState.panelOpen);
  readerState.panelToggle.classList.toggle('panel-open', readerState.panelOpen);
  readerState.mainContainer.classList.toggle('panel-open', readerState.panelOpen);
}
export // Search
function doSearch() {
  var q = (readerState.dictSearch.value || '').trim();
  if (!q) return;
  togglePanel(true);
  lookupAndDisplay(q, {
    raw: true,
    exact: true,
    allowFuzzy: true,
    noIsland: true,
    forceWholeToken: true
  });
}
export function showCreateForm() {
  togglePanel(true);
  var formHtml =
    '' +
    '<div class="userdict-form-wrapper">' +
    '  <h4 style="margin:0 0 8px 0;font-size:13px;font-weight:600;">Create custom dictionary entry</h4>' +
    '  <form id="userdict-form" class="userdict-form">' +
    '    <div class="userdict-field">' +
    '      <label for="userdict-head">Headword *</label>' +
    '      <input type="text" id="userdict-head" required>' +
    '    </div>' +
    '    <div class="userdict-field">' +
    '      <label for="userdict-pron">Pronunciation</label>' +
    '      <input type="text" id="userdict-pron">' +
    '    </div>' +
    '    <div class="userdict-field">' +
    '      <label for="userdict-pos">Part of speech</label>' +
    '      <input type="text" id="userdict-pos">' +
    '    </div>' +
    '    <div class="userdict-field">' +
    '      <label for="userdict-gloss">Gloss</label>' +
    '      <textarea id="userdict-gloss" rows="3"></textarea>' +
    '    </div>' +
    '    <div class="userdict-actions">' +
    '      <button type="submit" id="userdict-save-btn">Save</button>' +
    '    </div>' +
    '  </form>' +
    '  <div class="userdict-rule-sep"></div>' +
    '  <h4 style="margin:12px 0 8px 0;font-size:13px;font-weight:600;">Create custom rule</h4>' +
    '  <form id="userdict-rule-form" class="userdict-form">' +
    '    <div class="userdict-field">' +
    '      <label for="userdict-rule-head">Headword *</label>' +
    '      <input type="text" id="userdict-rule-head" required>' +
    '    </div>' +
    '    <div class="userdict-field">' +
    '      <label for="userdict-rule-correct">Correct headword</label>' +
    '      <input type="text" id="userdict-rule-correct">' +
    '    </div>' +
    '    <div class="userdict-actions">' +
    '      <button type="submit" id="userdict-rule-save-btn">Save</button>' +
    '    </div>' +
    '  </form>' +
    '</div>';
  readerState.panelContent.innerHTML = formHtml;
  var headInput = document.getElementById('userdict-head');
  var pronInput = document.getElementById('userdict-pron');
  var posInput = document.getElementById('userdict-pos');
  var glossInput = document.getElementById('userdict-gloss');
  var formEl = document.getElementById('userdict-form');
  var ruleHeadInput = document.getElementById('userdict-rule-head');
  var ruleCorrectInput = document.getElementById('userdict-rule-correct');
  var ruleFormEl = document.getElementById('userdict-rule-form');
  headInput.focus();
  formEl.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var head = (headInput.value || '').trim();
    var gloss = (glossInput.value || '').trim();
    if (!head) {
      alert('Headword is required.');
      return;
    }
    var payload = {
      headword: head,
      romanization: (pronInput.value || '').trim(),
      pos: (posInput.value || '').trim(),
      definition: gloss
    };
    var saveBtn = document.getElementById('userdict-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    fetch('/api/user_dict/add', {
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
          var msg = data && data.error ? data.error : 'Failed to save entry.';
          alert(msg);
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          }
          return;
        }
        lookupAndDisplay(head);
      })
      .catch(function (err) {
        console.error('Error saving user dict entry:', err);
        alert('Error saving entry.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      });
  });
  ruleFormEl.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var head = (ruleHeadInput.value || '').trim();
    var corrected = (ruleCorrectInput.value || '').trim();
    if (!head || !corrected) {
      alert('Headword and correct headword are required.');
      return;
    }
    var saveBtn = document.getElementById('userdict-rule-save-btn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }
    fetch('/api/text_override/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw: head,
        normalized: corrected
      })
    })
      .then(function (resp) {
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          var msg = data && data.error ? data.error : 'Failed to save rule.';
          alert(msg);
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
          }
          return;
        }
        lookupAndDisplay(corrected);
      })
      .catch(function (err) {
        console.error('Error saving rule:', err);
        alert('Error saving rule.');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
        }
      });
  });
}
export function initializeDictionarySearch() {
  readerState.panelToggle.addEventListener('click', function () {
    togglePanel();
  });
  readerState.searchBtn.addEventListener('click', doSearch);
  readerState.dictSearch.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') doSearch();
  });
  dictionarySearchState.customEntriesCache = [];
  dictionarySearchState.customEntriesFilter = 'all';
  return true;
}
