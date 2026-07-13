(function () {
  if (typeof URLSearchParams === 'undefined') return;
  var params = new URLSearchParams(window.location.search);
  if (params.get('edit') !== '1') return;

  var STORAGE_KEY = 'siteEditorPassword';
  var password = sessionStorage.getItem(STORAGE_KEY) || '';

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
    var editable = document.querySelectorAll('[data-editable="true"]');
    editable.forEach(function (el) {
      el.setAttribute('contenteditable', 'true');
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') e.preventDefault();
      });
    });
  }

  function save(statusEl) {
    statusEl.textContent = 'Saving...';

    var clone = document.documentElement.cloneNode(true);
    var panelInClone = clone.querySelector('#site-editor-panel');
    if (panelInClone && panelInClone.parentNode) panelInClone.parentNode.removeChild(panelInClone);
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
          status.textContent = 'Editing enabled — click any text to edit.';
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
    return { status: status, unlockRow: unlockRow, editRow: editRow };
  }

  function init() {
    var refs = buildPanel();
    if (password) {
      refs.status.textContent = 'Checking saved password...';
      verifyPassword(password).then(function (ok) {
        if (ok) {
          enableEditing();
          refs.unlockRow.style.display = 'none';
          refs.editRow.style.display = 'flex';
          refs.status.textContent = 'Editing enabled — click any text to edit.';
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
