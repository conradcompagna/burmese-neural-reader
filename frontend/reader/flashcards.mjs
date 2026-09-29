import { renderInitialExampleDemoIfAvailable, showInitialInputGuidanceIfEmpty } from './bootstrap-ui.mjs';
import { displayDictEntry, lookupAndDisplay } from './dictionary-panel.mjs';
import { renderSenseLines } from './dictionary-rendering.mjs';
import { togglePanel } from './dictionary-search.mjs';
import { documentPaginationState } from './document-pagination.state.mjs';
import { flashcardsState } from './flashcards.state.mjs';
import { buildLookupUrl, setDepTreeSourceMode } from './preferences.mjs';
import { renderG2PBlock } from './pronunciation-popups.mjs';
import { readerState } from './reader-state.state.mjs';
import { escapeHtml } from './text.mjs';
export function openFlashcardMode() {
  if (!flashcardsState.flashcardOverlay) return;
  flashcardsState.flashcardOverlay.style.display = 'flex';
  resetFlashcardUI();
  loadNextFlashcard();
}
export function resetFlashcardUI() {
  flashcardsState.flashcardMessage.textContent = '';
  if (flashcardsState.flashcardStats) flashcardsState.flashcardStats.textContent = '';
  if (flashcardsState.flashcardWord) flashcardsState.flashcardWord.style.display = 'block';
  if (flashcardsState.flashcardShowAnswerBtn) flashcardsState.flashcardShowAnswerBtn.style.display = 'block';
  if (flashcardsState.flashcardAnswer) flashcardsState.flashcardAnswer.style.display = 'none';
  if (flashcardsState.flashcardGradeButtons) flashcardsState.flashcardGradeButtons.style.display = 'none';
  if (flashcardsState.flashcardPronunciation) flashcardsState.flashcardPronunciation.innerHTML = '';
  if (flashcardsState.flashcardDictionary) flashcardsState.flashcardDictionary.innerHTML = '';
  if (flashcardsState.flashcardGrammar) flashcardsState.flashcardGrammar.innerHTML = '';
  if (flashcardsState.flashcardAnnotation) flashcardsState.flashcardAnnotation.value = '';
}
export function closeFlashcardMode() {
  if (!flashcardsState.flashcardOverlay) return;
  flashcardsState.flashcardOverlay.style.display = 'none';
  flashcardsState.flashcardCurrent = null;
}
export function loadNextFlashcard() {
  if (flashcardsState.flashcardIsLoading) return;
  flashcardsState.flashcardIsLoading = true;
  if (!flashcardsState.flashcardOverlay) return;
  resetFlashcardUI();
  flashcardsState.flashcardWord.textContent = '...';
  if (flashcardsState.flashcardShowAnswerBtn) flashcardsState.flashcardShowAnswerBtn.disabled = true;
  fetch('/api/reading_srs/next_card')
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      flashcardsState.flashcardIsLoading = false;
      if (!data || !data.ok || !data.card) {
        flashcardsState.flashcardCurrent = null;
        flashcardsState.flashcardWord.textContent = 'No cards available';
        if (flashcardsState.flashcardShowAnswerBtn)
          flashcardsState.flashcardShowAnswerBtn.style.display = 'none';
        var msg =
          (data && data.error) || 'Paste and analyze some text first so the reader can collect known words.';
        flashcardsState.flashcardMessage.textContent = msg;
        return;
      }
      var card = data.card;
      flashcardsState.flashcardCurrent = card;
      var head = card.head || '';
      var display = card.display || head;
      flashcardsState.flashcardWord.textContent = display || head || '...';
      flashcardsState.flashcardMessage.textContent = card.is_new ? 'New word' : 'Review';
      var stats = card.stats || {};
      var review = card.review || {};
      var seen = stats.total_seen || 0;
      var reps = review.repetitions || 0;
      if (flashcardsState.flashcardStats)
        flashcardsState.flashcardStats.textContent = 'Seen ' + seen + 'x / Repetitions ' + reps;
      if (flashcardsState.flashcardShowAnswerBtn) flashcardsState.flashcardShowAnswerBtn.disabled = false;
    })
    .catch(function (err) {
      console.error('reading_srs next_card error', err);
      flashcardsState.flashcardIsLoading = false;
      flashcardsState.flashcardWord.textContent = 'Error';
      flashcardsState.flashcardMessage.textContent = 'Failed to load next card.';
      if (flashcardsState.flashcardShowAnswerBtn)
        flashcardsState.flashcardShowAnswerBtn.style.display = 'none';
    });
}
export function showFlashcardAnswer() {
  if (!flashcardsState.flashcardCurrent) return;
  var head = flashcardsState.flashcardCurrent.head || flashcardsState.flashcardCurrent.display || '';
  if (!head) return;
  if (flashcardsState.flashcardWord) flashcardsState.flashcardWord.style.display = 'none';
  if (flashcardsState.flashcardShowAnswerBtn) flashcardsState.flashcardShowAnswerBtn.style.display = 'none';
  if (flashcardsState.flashcardAnswer) flashcardsState.flashcardAnswer.style.display = 'flex';
  if (flashcardsState.flashcardGradeButtons) flashcardsState.flashcardGradeButtons.style.display = 'flex';
  if (flashcardsState.flashcardKnowBtn) flashcardsState.flashcardKnowBtn.disabled = false;
  if (flashcardsState.flashcardDontKnowBtn) flashcardsState.flashcardDontKnowBtn.disabled = false;
  loadFlashcardContent(head);
}
export function gradeFlashcard(knew) {
  if (!flashcardsState.flashcardCurrent || flashcardsState.flashcardIsLoading) return;
  var head = flashcardsState.flashcardCurrent.head || flashcardsState.flashcardCurrent.display || '';
  if (!head) return;
  if (flashcardsState.flashcardKnowBtn) flashcardsState.flashcardKnowBtn.disabled = true;
  if (flashcardsState.flashcardDontKnowBtn) flashcardsState.flashcardDontKnowBtn.disabled = true;
  fetch('/api/reading_srs/grade', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      head: head,
      knew: !!knew
    })
  })
    .then(function (resp) {
      return resp.json();
    })
    .then(function (data) {
      if (!data || !data.ok) {
        flashcardsState.flashcardMessage.textContent = 'Failed to update card.';
        if (flashcardsState.flashcardKnowBtn) flashcardsState.flashcardKnowBtn.disabled = false;
        if (flashcardsState.flashcardDontKnowBtn) flashcardsState.flashcardDontKnowBtn.disabled = false;
        return;
      }
      loadNextFlashcard();
    })
    .catch(function (err) {
      console.error('reading_srs grade error', err);
      flashcardsState.flashcardMessage.textContent = 'Failed to update card.';
      if (flashcardsState.flashcardKnowBtn) flashcardsState.flashcardKnowBtn.disabled = false;
      if (flashcardsState.flashcardDontKnowBtn) flashcardsState.flashcardDontKnowBtn.disabled = false;
    });
}
export function loadFlashcardContent(head) {
  if (!head) return;
  if (flashcardsState.flashcardPronunciation)
    flashcardsState.flashcardPronunciation.innerHTML = '<div class="flashcard-loading">Loading...</div>';
  if (flashcardsState.flashcardDictionary)
    flashcardsState.flashcardDictionary.innerHTML = '<div class="flashcard-loading">Loading...</div>';
  if (flashcardsState.flashcardGrammar) flashcardsState.flashcardGrammar.innerHTML = '';
  // Fetch dictionary data (includes g2p and grammar_overlay)
  fetch(buildLookupUrl(head))
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      // Pronunciation
      if (flashcardsState.flashcardPronunciation) {
        var g2pData = (data && data.results && data.results[0] && data.results[0].g2p) || (data && data.g2p);
        var g2pContent = '';
        if (g2pData) {
          if (typeof renderG2PBlock === 'function' && g2pData.syllables && Array.isArray(g2pData.syllables)) {
            g2pContent = renderG2PBlock(g2pData, true);
          } else if (typeof g2pData === 'string' && g2pData.trim()) {
            g2pContent = '<div class="flashcard-g2p">' + escapeHtml(g2pData) + '</div>';
          }
        }
        if (g2pContent) {
          flashcardsState.flashcardPronunciation.innerHTML = g2pContent;
        } else {
          flashcardsState.flashcardPronunciation.innerHTML = '';
        }
      }
      // Dictionary
      if (flashcardsState.flashcardDictionary) {
        if (data && data.ok && data.results && data.results.length) {
          var main = data.results[0];
          var senses = main.senses || [];
          var dictHtml = '<div class="flashcard-section-title">Dictionary</div>';
          if (senses.length && typeof renderSenseLines === 'function') {
            dictHtml += renderSenseLines(senses, head);
          } else {
            dictHtml += '<div class="popup-empty">[no senses found]</div>';
          }
          flashcardsState.flashcardDictionary.innerHTML = dictHtml;
        } else {
          flashcardsState.flashcardDictionary.innerHTML = '';
        }
      }
      // Grammar overlay senses (from /lookup response)
      if (flashcardsState.flashcardGrammar && data && data.grammar_overlay) {
        var gramOverlay = data.grammar_overlay;
        if (gramOverlay && gramOverlay.tokens && gramOverlay.tokens.length) {
          var token = gramOverlay.tokens[0];
          var grammarEntries = token.grammar || [];
          if (grammarEntries.length) {
            var gramHtml = '<div class="flashcard-section-title">Grammar</div>';
            for (var i = 0; i < grammarEntries.length; i++) {
              var entry = grammarEntries[i];
              gramHtml += '<div class="flashcard-grammar-entry">';
              gramHtml +=
                '<div class="flashcard-grammar-category">' +
                escapeHtml(entry.category || entry.type || '') +
                '</div>';
              gramHtml += '<div class="flashcard-grammar-gloss">' + escapeHtml(entry.gloss || '') + '</div>';
              gramHtml += '</div>';
            }
            flashcardsState.flashcardGrammar.innerHTML = gramHtml;
          }
        }
      }
      // Load existing annotation
      fetch('/annotation?head=' + encodeURIComponent(head))
        .then(function (resp) {
          return resp.json();
        })
        .then(function (aData) {
          if (aData && aData.ok && typeof aData.note === 'string' && flashcardsState.flashcardAnnotation) {
            flashcardsState.flashcardAnnotation.value = aData.note;
          }
        })
        .catch(function (err) {
          console.error('annotation load error', err);
        });
    })
    .catch(function (err) {
      console.error('flashcard content load error', err);
      if (flashcardsState.flashcardPronunciation)
        flashcardsState.flashcardPronunciation.innerHTML =
          '<div class="flashcard-error">Failed to load.</div>';
      if (flashcardsState.flashcardDictionary)
        flashcardsState.flashcardDictionary.innerHTML = '<div class="flashcard-error">Failed to load.</div>';
    });
}
export function saveFlashcardAnnotation() {
  if (!flashcardsState.flashcardCurrent || !flashcardsState.flashcardAnnotation) return;
  var head = flashcardsState.flashcardCurrent.head || flashcardsState.flashcardCurrent.display || '';
  if (!head) return;
  var note = flashcardsState.flashcardAnnotation.value;
  fetch('/annotation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      head: head,
      note: note
    })
  }).catch(function (err) {
    console.error('annotation autosave error', err);
  });
}
export function initializeFlashcards() {
  // ---------------- Flashcard UI (reading SRS) ----------------
  flashcardsState.flashcardOverlay = document.getElementById('flashcardOverlay');
  flashcardsState.flashcardWord = document.getElementById('flashcardWord');
  flashcardsState.flashcardMessage = document.getElementById('flashcardMessage');
  flashcardsState.flashcardStats = document.getElementById('flashcardStats');
  flashcardsState.flashcardShowAnswerBtn = document.getElementById('flashcardShowAnswerBtn');
  flashcardsState.flashcardAnswer = document.getElementById('flashcardAnswer');
  flashcardsState.flashcardGradeButtons = document.getElementById('flashcardGradeButtons');
  flashcardsState.flashcardPronunciation = document.getElementById('flashcardPronunciation');
  flashcardsState.flashcardDictionary = document.getElementById('flashcardDictionary');
  flashcardsState.flashcardGrammar = document.getElementById('flashcardGrammar');
  flashcardsState.flashcardAnnotation = document.getElementById('flashcardAnnotation');
  flashcardsState.flashcardKnowBtn = document.getElementById('flashcardKnowBtn');
  flashcardsState.flashcardDontKnowBtn = document.getElementById('flashcardDontKnowBtn');
  flashcardsState.flashcardCloseBtn = document.getElementById('flashcardCloseBtn');
  flashcardsState.flashcardModeBtn = document.getElementById('flashcardModeBtn');
  flashcardsState.flashcardCurrent = null;
  flashcardsState.flashcardIsLoading = false;
  flashcardsState.flashcardAnnotationSaveTimeout = null;
  if (flashcardsState.flashcardModeBtn) {
    flashcardsState.flashcardModeBtn.addEventListener('click', function () {
      openFlashcardMode();
    });
  }
  if (flashcardsState.flashcardCloseBtn) {
    flashcardsState.flashcardCloseBtn.addEventListener('click', function () {
      closeFlashcardMode();
    });
  }
  if (flashcardsState.flashcardShowAnswerBtn) {
    flashcardsState.flashcardShowAnswerBtn.addEventListener('click', function () {
      showFlashcardAnswer();
    });
  }
  if (flashcardsState.flashcardKnowBtn) {
    flashcardsState.flashcardKnowBtn.addEventListener('click', function () {
      gradeFlashcard(true);
    });
  }
  if (flashcardsState.flashcardDontKnowBtn) {
    flashcardsState.flashcardDontKnowBtn.addEventListener('click', function () {
      gradeFlashcard(false);
    });
  }
  // Autosave annotation with debounce
  if (flashcardsState.flashcardAnnotation) {
    flashcardsState.flashcardAnnotation.addEventListener('input', function () {
      if (flashcardsState.flashcardAnnotationSaveTimeout) {
        clearTimeout(flashcardsState.flashcardAnnotationSaveTimeout);
      }
      flashcardsState.flashcardAnnotationSaveTimeout = setTimeout(function () {
        saveFlashcardAnnotation();
      }, 1000);
    });
  }

  // ===================== LEFT SIDEBAR MENU =====================
  flashcardsState.leftMenu = document.getElementById('left-menu');
  flashcardsState.menuToggle = document.getElementById('menu-toggle');
  flashcardsState.menuSections = document.querySelectorAll('.menu-section');
  flashcardsState.thresholdSlider = document.getElementById('bottomUpChunkThreshold');
  flashcardsState.thresholdValue = document.querySelector('.menu-slider-value');

  // Menu toggle (collapse/expand sidebar) - mirrors panel-toggle behavior
  if (flashcardsState.menuToggle && flashcardsState.leftMenu) {
    flashcardsState.menuToggle.addEventListener('click', function () {
      var isOpen = flashcardsState.menuToggle.classList.contains('menu-open');
      if (isOpen) {
        // Close the menu
        flashcardsState.leftMenu.classList.add('collapsed');
        flashcardsState.menuToggle.classList.remove('menu-open');
      } else {
        // Open the menu
        flashcardsState.leftMenu.classList.remove('collapsed');
        flashcardsState.menuToggle.classList.add('menu-open');
      }
    });
  }

  // Toggle behavior for menu sections (multiple can be open at once)
  flashcardsState.menuSections.forEach(function (section) {
    var header = section.querySelector('.menu-section-header');
    if (header) {
      header.addEventListener('click', function () {
        section.classList.toggle('open');
      });
    }
  });

  // Slider value display update
  if (flashcardsState.thresholdSlider && flashcardsState.thresholdValue) {
    flashcardsState.thresholdSlider.addEventListener('input', function () {
      flashcardsState.thresholdValue.textContent = this.value;
    });
    // Sync initial value
    flashcardsState.thresholdValue.textContent = flashcardsState.thresholdSlider.value;
  }

  // Expose dictionary popup helpers for the reader interface.
  window.togglePanel = togglePanel;
  window.displayDictEntry = displayDictEntry;
  window.lookupAndDisplay = lookupAndDisplay;
  window.getSyntheticLookupText = function () {
    var idx = documentPaginationState.activePageIndex || 0;
    if (
      documentPaginationState.pageLookupTextByIndex &&
      documentPaginationState.pageLookupTextByIndex[idx] != null
    ) {
      return String(documentPaginationState.pageLookupTextByIndex[idx] || '');
    }
    return String(readerState.latestOriginalText || '');
  };
  window.getSyntheticLookupTextDebug = function () {
    var t = window.getSyntheticLookupText();
    return t.replace(/ /g, '[SP]').replace(/\n/g, '\\n\n');
  };
  window.setDepTreeSourceMode = setDepTreeSourceMode;
  Object.defineProperty(window, 'latestData', {
    get: function () {
      return readerState.latestData;
    },
    set: function (v) {
      readerState.latestData = v;
    },
    configurable: true
  });

  // On page load, show English guidance in the input and a one-time cached demo in output.
  setTimeout(function () {
    showInitialInputGuidanceIfEmpty();
    renderInitialExampleDemoIfAvailable();
  }, 100);
  return true;
}
