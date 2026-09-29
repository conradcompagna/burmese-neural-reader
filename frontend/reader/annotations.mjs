import { hoverInteractionState } from './hover-interaction.state.mjs';
import { readerState } from './reader-state.state.mjs';
import { debounce } from './text.mjs';
export function applyNoteToPopup(head, note) {
  if (!readerState.notePopup) return;
  if (head !== hoverInteractionState.currentPopupHead) return;
  note = note || '';
  if (note.trim()) {
    readerState.notePopup.textContent = note;
    readerState.notePopup.style.display = 'block';
    readerState.hoverPopupContainer.style.display = 'flex';
  } else {
    readerState.notePopup.textContent = '';
    readerState.notePopup.style.display = 'none';
  }
}
export function updateNotePopupForHead(head) {
  if (!readerState.notePopup) return;
  hoverInteractionState.currentPopupHead = head || null;
  if (!head) {
    readerState.notePopup.textContent = '';
    readerState.notePopup.style.display = 'none';
    return;
  }
  if (hoverInteractionState.noteCache.has(head)) {
    applyNoteToPopup(head, hoverInteractionState.noteCache.get(head));
    return;
  }
  fetch('/annotation?head=' + encodeURIComponent(head))
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (head !== hoverInteractionState.currentPopupHead) return;
      var note = data && data.ok && typeof data.note === 'string' ? data.note : '';
      hoverInteractionState.noteCache.set(head, note);
      applyNoteToPopup(head, note);
    })
    .catch(function () {
      if (head !== hoverInteractionState.currentPopupHead) return;
      hoverInteractionState.noteCache.set(head, '');
      applyNoteToPopup(head, '');
    });
}
export function setupAnnotationBox(head) {
  var area = document.getElementById('dict-annotation');
  var statusEl = document.getElementById('dict-annotation-status');
  if (!area) return;
  fetch('/annotation?head=' + encodeURIComponent(head))
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      var note = data && data.ok && typeof data.note === 'string' ? data.note : '';
      area.value = note;
      hoverInteractionState.noteCache.set(head, note);
      if (statusEl) statusEl.textContent = note ? 'Saved' : '';
    })
    .catch(function () {
      if (statusEl) statusEl.textContent = 'Could not load note';
    });
  var saveNote = debounce(function () {
    var value = area.value || '';
    fetch('/annotation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        head: head,
        note: value
      })
    })
      .then(function (resp) {
        return resp.json();
      })
      .then(function (data) {
        if (!data || !data.ok) {
          if (statusEl) statusEl.textContent = 'Error saving';
          return;
        }
        hoverInteractionState.noteCache.set(head, value);
        if (statusEl) {
          statusEl.textContent = value.trim() ? 'Saved' : 'Note cleared';
        }
        if (hoverInteractionState.currentPopupHead === head) {
          applyNoteToPopup(head, value);
        }
      })
      .catch(function () {
        if (statusEl) statusEl.textContent = 'Error saving';
      });
  }, 500);
  area.oninput = function () {
    if (statusEl) statusEl.textContent = 'Saving...';
    saveNote();
  };
}
// DOM refs
