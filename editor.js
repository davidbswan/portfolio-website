(function () {
  if (typeof URLSearchParams === 'undefined') return;
  var params = new URLSearchParams(window.location.search);
  if (params.get('edit') !== '1') return;

  var STORAGE_KEY = 'siteEditorPassword';
  var password = sessionStorage.getItem(STORAGE_KEY) || '';
  var editingEnabled = false;
  var activeEl = null;

  // Brand palette (see brand-style-reference) used for the formatting toolbar's
  // color swatches, so per-element color changes stay on-brand by default.
  var SWATCHES = [
    { label: 'Text', value: '#1F2328' },
    { label: 'Deep Blue', value: '#445564' },
    { label: 'Primary', value: '#6B8798' },
    { label: 'Light Blue', value: '#9CB2BE' },
    { label: 'Accent', value: '#CDB8A3' },
    { label: 'Background', value: '#F8F8F6' },
  ];

  // Weights already used elsewhere in the site's own stylesheet, so applying
  // any of these renders consistently with the rest of the page.
  var WEIGHTS = [
    { label: 'Reg', value: '400' },
    { label: 'Med', value: '500' },
    { label: 'Semi', value: '600' },
    { label: 'Bold', value: '700' },
    { label: 'Black', value: '900' },
  ];

  function jsonFetch(body) {
    return fetch('/api/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Edit-Password': password,
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      });
    });
  }

  function verifyPassword(pw) {
    var prev = password;
    password = pw;
    return jsonFetch({ action: 'verify' }).then(function (result) {
      if (result.data && result.data.ok) {
        sessionStorage.setItem(STORAGE_KEY, pw);
        return true;
      }
      password = prev;
      return false;
    });
  }

  function enableEditing() {
    editingEnabled = true;
    var editable = document.querySelectorAll('[data-editable="true"]');
    editable.forEach(function (el) {
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });
    });
  }

  // ---- Per-element / per-word formatting toolbar ----
  // Appears above whichever editable element currently has focus. If the
  // user has highlighted a word or phrase inside the element, formatting
  // applies to just that selection (wrapped in a <span class="site-editor-fmt">,
  // same technique as the existing hand-coded highlight word on the homepage).
  // If nothing is highlighted, it applies to the element's whole content.
  //
  // Font-size changes are stored as an "em" value relative to the wrapping
  // span's parent, not a fixed pixel value. Since the parent (the original
  // heading/paragraph) keeps its own CSS-driven responsive font-size at every
  // breakpoint, the wrapped text's size scales proportionally right along
  // with it instead of freezing at one fixed size on all screen widths.

  function getTargetSpan(range) {
    var text = range.toString();
    if (!text) return null;
    var node = range.commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    if (!node || node.nodeType !== 1) return null;
    if (node.classList && node.classList.contains('site-editor-fmt') && node.textContent === text) {
      return node;
    }
    if (node.children && node.children.length === 1 &&
        node.children[0].classList && node.children[0].classList.contains('site-editor-fmt') &&
        node.children[0].textContent === text && node.textContent === text) {
      return node.children[0];
    }
    return null;
  }

  function currentRange() {
    if (!activeEl) return null;
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (!r.collapsed && activeEl.contains(r.commonAncestorContainer)) return r.cloneRange();
    }
    var whole = document.createRange();
    whole.selectNodeContents(activeEl);
    return whole;
  }

  function applyToRange(range, mutator) {
    if (!activeEl || !range) return;
    var span = getTargetSpan(range);
    if (!span) {
      span = document.createElement('span');
      span.className = 'site-editor-fmt';
      var frag = range.extractContents();
      // Don't wrap empty selections (e.g. a collapsed range on an empty element).
      if (!frag.textContent) {
        range.insertNode(frag);
        return;
      }
      span.appendChild(frag);
      range.insertNode(span);
    }
    mutator(span);

    var sel = window.getSelection();
    var newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(newRange);
  }

  function unwrapSpan(span) {
    var parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  }

  function resetFormat() {
    if (!activeEl) return;
    var range = currentRange();
    var span = range ? getTargetSpan(range) : null;
    if (span) {
      unwrapSpan(span);
    } else {
      var spans = activeEl.querySelectorAll('span.site-editor-fmt');
      spans.forEach(unwrapSpan);
    }
  }

  function stepFontSize(span, delta) {
    var parentPx = parseFloat(window.getComputedStyle(span.parentElement || activeEl).fontSize) || 16;
    var currentPx = parseFloat(window.getComputedStyle(span).fontSize) || parentPx;
    var nextPx = Math.max(8, Math.min(400, currentPx + delta));
    span.style.fontSize = (nextPx / parentPx).toFixed(3) + 'em';
  }

  function buildFormatToolbar() {
    var toolbar = document.createElement('div');
    toolbar.id = 'site-editor-format-toolbar';
    toolbar.style.cssText = 'position:fixed;display:none;z-index:999998;background:#111;color:#fff;font-family:system-ui,sans-serif;font-size:12px;padding:8px 10px;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.35);flex-direction:row;align-items:center;gap:10px;';

    // All controls use 'mousedown' + preventDefault (not 'click') so the
    // button never steals focus from the contentEditable element — that
    // keeps the user's text selection (if any) intact so we know whether to
    // format just the highlighted word/phrase or the whole element.

    var colorGroup = document.createElement('div');
    colorGroup.style.cssText = 'display:flex;gap:4px;align-items:center;';
    SWATCHES.forEach(function (sw) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.title = sw.label;
      btn.style.cssText = 'width:18px;height:18px;border-radius:50%;border:1px solid rgba(255,255,255,.4);cursor:pointer;padding:0;background:' + sw.value + ';';
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var range = currentRange();
        applyToRange(range, function (span) { span.style.color = sw.value; });
      });
      colorGroup.appendChild(btn);
    });

    var customColor = document.createElement('input');
    customColor.type = 'color';
    customColor.title = 'Custom color';
    customColor.style.cssText = 'width:20px;height:20px;border:0;padding:0;background:none;cursor:pointer;';
    var savedRangeForColorPicker = null;
    customColor.addEventListener('mousedown', function () {
      // The native color picker steals focus once it opens, so capture the
      // range now — it stays valid as a DOM reference even after the
      // contentEditable loses focus.
      savedRangeForColorPicker = currentRange();
    });
    customColor.addEventListener('input', function (e) {
      applyToRange(savedRangeForColorPicker, function (span) { span.style.color = e.target.value; });
    });
    colorGroup.appendChild(customColor);

    var weightGroup = document.createElement('div');
    weightGroup.style.cssText = 'display:flex;gap:4px;border-left:1px solid #333;padding-left:10px;';
    WEIGHTS.forEach(function (w) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = w.label;
      btn.style.cssText = 'padding:4px 6px;border:0;border-radius:4px;background:#222;color:#fff;cursor:pointer;font-size:11px;';
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var range = currentRange();
        applyToRange(range, function (span) { span.style.fontWeight = w.value; });
      });
      weightGroup.appendChild(btn);
    });

    var sizeGroup = document.createElement('div');
    sizeGroup.style.cssText = 'display:flex;gap:4px;align-items:center;border-left:1px solid #333;padding-left:10px;';

    var shrinkBtn = document.createElement('button');
    shrinkBtn.type = 'button';
    shrinkBtn.textContent = 'A-';
    shrinkBtn.style.cssText = 'padding:4px 6px;border:0;border-radius:4px;background:#222;color:#fff;cursor:pointer;font-size:11px;';
    shrinkBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var range = currentRange();
      applyToRange(range, function (span) { stepFontSize(span, -2); });
    });

    var growBtn = document.createElement('button');
    growBtn.type = 'button';
    growBtn.textContent = 'A+';
    growBtn.style.cssText = 'padding:4px 6px;border:0;border-radius:4px;background:#222;color:#fff;cursor:pointer;font-size:11px;';
    growBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var range = currentRange();
      applyToRange(range, function (span) { stepFontSize(span, 2); });
    });

    sizeGroup.appendChild(shrinkBtn);
    sizeGroup.appendChild(growBtn);

    var resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset';
    resetBtn.title = 'Clear formatting — on the highlighted word if one is selected, otherwise the whole element';
    resetBtn.style.cssText = 'padding:4px 6px;border:0;border-radius:4px;background:#333;color:#fff;cursor:pointer;font-size:11px;border-left:1px solid #333;margin-left:2px;';
    resetBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      resetFormat();
    });

    toolbar.appendChild(colorGroup);
    toolbar.appendChild(weightGroup);
    toolbar.appendChild(sizeGroup);
    toolbar.appendChild(resetBtn);
    document.body.appendChild(toolbar);
    return toolbar;
  }

  function positionToolbar(toolbar, el) {
    toolbar.style.display = 'flex';
    // Measure after making visible so offsetHeight/Width are accurate.
    var rect = el.getBoundingClientRect();
    var tRect = toolbar.getBoundingClientRect();
    var top = rect.top - tRect.height - 10;
    if (top < 8) top = rect.bottom + 10;
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - tRect.width - 8));
    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
  }

  function initFormatToolbar() {
    var toolbar = buildFormatToolbar();

    document.addEventListener('focusin', function (e) {
      if (!editingEnabled) return;
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-editable') === 'true') {
        activeEl = e.target;
        positionToolbar(toolbar, activeEl);
      }
    });

    document.addEventListener('click', function (e) {
      if (!editingEnabled) return;
      var insideToolbar = toolbar.contains(e.target);
      var onEditable = e.target && e.target.closest && e.target.closest('[data-editable="true"]');
      if (!insideToolbar && !onEditable) {
        toolbar.style.display = 'none';
        activeEl = null;
      }
    });

    window.addEventListener('scroll', function () {
      toolbar.style.display = 'none';
    }, true);

    return toolbar;
  }

  function save(statusEl) {
    statusEl.textContent = 'Saving...';

    var clone = document.documentElement.cloneNode(true);
    var panelInClone = clone.querySelector('#site-editor-panel');
    if (panelInClone && panelInClone.parentNode) panelInClone.parentNode.removeChild(panelInClone);
    var toolbarInClone = clone.querySelector('#site-editor-format-toolbar');
    if (toolbarInClone && toolbarInClone.parentNode) toolbarInClone.parentNode.removeChild(toolbarInClone);
    var editableClones = clone.querySelectorAll('[data-editable="true"]');
    editableClones.forEach(function (el) {
      el.removeAttribute('contenteditable');
    });

    var html = '<!DOCTYPE html>\n' + clone.outerHTML;

    jsonFetch({
      path: 'index.html',
      content: html,
      message: 'Live edit via site editor (' + new Date().toISOString() + ')',
    }).then(function (result) {
      if (result.data && result.data.ok) {
        statusEl.textContent = 'Saved! (may take a minute to go live)';
      } else {
        var msg = (result.data && result.data.error) ? result.data.error : ('HTTP ' + result.status);
        statusEl.textContent = 'Error: ' + msg;
      }
    }).catch(function (err) {
      statusEl.textContent = 'Error: ' + err.message;
    });
  }

  function buildPanel() {
    var panel = document.createElement('div');
    panel.id = 'site-editor-panel';
    panel.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:999999;background:#111;color:#fff;font-family:system-ui,sans-serif;font-size:14px;padding:14px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);display:flex;flex-direction:column;gap:10px;min-width:240px;';

    var status = document.createElement('div');
    status.id = 'site-editor-status';
    status.textContent = 'Site editor';
    panel.appendChild(status);

    var unlockRow = document.createElement('div');
    unlockRow.id = 'site-editor-unlock-row';
    unlockRow.style.cssText = 'display:flex;gap:8px;';

    var pwInput = document.createElement('input');
    pwInput.type = 'password';
    pwInput.placeholder = 'Password';
    pwInput.style.cssText = 'flex:1;min-width:0;padding:8px 10px;border:1px solid #444;border-radius:6px;background:#222;color:#fff;font-size:13px;';

    var unlockBtn = document.createElement('button');
    unlockBtn.textContent = 'Unlock';
    unlockBtn.style.cssText = 'padding:8px 10px;border:0;border-radius:6px;background:#4f8cff;color:#fff;cursor:pointer;font-size:13px;';

    unlockRow.appendChild(pwInput);
    unlockRow.appendChild(unlockBtn);
    panel.appendChild(unlockRow);

    var hint = document.createElement('div');
    hint.id = 'site-editor-hint';
    hint.style.cssText = 'display:none;font-size:11px;color:#999;line-height:1.4;';
    hint.textContent = 'Click text to edit. Highlight a word to format just that word, or leave nothing highlighted to format the whole element.';
    panel.appendChild(hint);

    var editRow = document.createElement('div');
    editRow.id = 'site-editor-edit-row';
    editRow.style.cssText = 'display:none;gap:8px;';

    var saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save changes';
    saveBtn.style.cssText = 'flex:1;padding:8px 10px;border:0;border-radius:6px;background:#4f8cff;color:#fff;cursor:pointer;font-size:13px;';

    var exitBtn = document.createElement('button');
    exitBtn.textContent = 'Exit';
    exitBtn.style.cssText = 'padding:8px 10px;border:0;border-radius:6px;background:#333;color:#fff;cursor:pointer;font-size:13px;';
    exitBtn.addEventListener('click', function () {
      var url = new URL(window.location.href);
      url.searchParams.delete('edit');
      window.location.href = url.toString();
    });

    editRow.appendChild(saveBtn);
    editRow.appendChild(exitBtn);
    panel.appendChild(editRow);

    function doUnlock() {
      var pw = pwInput.value;
      if (!pw) return;
      status.textContent = 'Checking...';
      verifyPassword(pw).then(function (ok) {
        if (ok) {
          enableEditing();
          unlockRow.style.display = 'none';
          editRow.style.display = 'flex';
          hint.style.display = 'block';
          status.textContent = 'Editing enabled';
        } else {
          status.textContent = 'Wrong password.';
        }
      });
    }

    unlockBtn.addEventListener('click', doUnlock);
    pwInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        doUnlock();
      }
    });

    saveBtn.addEventListener('click', function () {
      save(status);
    });

    document.body.appendChild(panel);
    return { status: status, unlockRow: unlockRow, editRow: editRow, hint: hint };
  }

  function init() {
    var refs = buildPanel();
    initFormatToolbar();
    if (password) {
      refs.status.textContent = 'Checking saved password...';
      verifyPassword(password).then(function (ok) {
        if (ok) {
          enableEditing();
          refs.unlockRow.style.display = 'none';
          refs.editRow.style.display = 'flex';
          refs.hint.style.display = 'block';
          refs.status.textContent = 'Editing enabled';
        } else {
          refs.status.textContent = 'Site editor';
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
