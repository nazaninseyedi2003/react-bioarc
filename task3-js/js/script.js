/* =========================================================
   بایوآرک — منطق صفحه با jQuery
   بخش‌ها: ۱) پاپ‌آور  ۲) ادیتور و نوار ابزار  ۳) منشن
           ۴) فایل/سند  ۵) تب‌ها و ضبط صدا  ۶) ثبت و بستن فرم
           ۷) ذخیره‌سازی ماندگار (بازیابی بعد از رفرش)
========================================================= */
$(function () {
    'use strict';

    /* ---------- تنظیمات ---------- */
    var MAX_FILE_SIZE = 10 * 1024 * 1024;          // ۱۰ مگابایت
    var ALLOWED_EXT = ['jpg', 'jpeg', 'png', 'pdf', 'docx'];
    var AVATAR = './img/Group 239871.png';
    // لیست نمونه‌ی کاربران برای منشن (بعداً از سرور بخوانید)
    var USERS = [
        { id: 1, name: 'علیرضا گودرزی' },
        { id: 2, name: 'سارا احمدی' },
        { id: 3, name: 'محمد رضایی' },
        { id: 4, name: 'مریم کریمی' },
        { id: 5, name: 'امیر حسینی' }
    ];

    var $editor = $('#feedbackInput');
    var closeIconHtml = $('#mentionBox .close').first().html(); // آیکون SVG دکمه حذف منشن
    var currentTab = 'text';

    /* =========================================================
       ۰) ذخیره‌سازی ماندگار
       - localStorage: متن، منشن‌ها، تب، وضعیت بخش‌ها (داده‌ی کوچک)
       - IndexedDB: فایل‌ها، صدای ضبط‌شده و بازخوردهای ثبت‌شده (داده‌ی حجیم)
    ========================================================= */
    var LS_KEY = 'bioark:draft:v1';
    var DB_NAME = 'bioark-feedback';
    var restoring = true;     // تا پایان بازیابی، چیزی ذخیره نمی‌شود
    var formClosed = false;
    var saveTimer = null;
    var dbPromise = null;

    function openDb() {
        if (dbPromise) { return dbPromise; }
        dbPromise = new Promise(function (resolve, reject) {
            if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                db.createObjectStore('files', { keyPath: 'id' });
                db.createObjectStore('kv');
                db.createObjectStore('feedbacks', { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
        return dbPromise;
    }

    function store(name, mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(name, mode);
                var r = fn(t.objectStore(name));
                t.oncomplete = function () { resolve(r ? r.result : undefined); };
                t.onerror = t.onabort = function () { reject(t.error); };
            });
        });
    }
    function dbPut(name, val, key) { return store(name, 'readwrite', function (s) { return key === undefined ? s.put(val) : s.put(val, key); }); }
    function dbGet(name, key) { return store(name, 'readonly', function (s) { return s.get(key); }); }
    function dbAll(name) { return store(name, 'readonly', function (s) { return s.getAll(); }); }
    function dbDel(name, key) { return store(name, 'readwrite', function (s) { return s.delete(key); }); }
    function dbClear(name) { return store(name, 'readwrite', function (s) { return s.clear(); }); }
    function dbFail() { showToast('ذخیره‌سازی در مرورگر ممکن نشد؛ ممکن است بعد از رفرش از بین برود.', true); }

    function saveDraft() {
        if (restoring) { return; }
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({
                html: $editor.html(),
                mentions: mentionedIds(),
                tab: currentTab,
                uploadOpen: $('#fileToggle').attr('aria-expanded') === 'true',
                closed: formClosed,
                nextId: nextId
            }));
        } catch (err) { /* حافظه پر است یا غیرفعال */ }
    }
    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 250);
    }
    $(window).on('pagehide beforeunload', function () { clearTimeout(saveTimer); saveDraft(); });

    // فقط تگ‌ها و ویژگی‌های امن ادیتور اجازه‌ی بازیابی دارند
    var ALLOWED_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, A: 1, BLOCKQUOTE: 1, DIV: 1, BR: 1, P: 1, SPAN: 1 };
    var ALIGNS = ['left', 'right', 'center', 'justify'];
    function sanitizeHtml(html) {
        var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
        (function clean(node) {
            $(node).contents().each(function () {
                if (this.nodeType === 3) { return; }
                if (this.nodeType !== 1 || !ALLOWED_TAGS[this.tagName]) { $(this).remove(); return; }
                var el = this;
                $.each(Array.prototype.slice.call(el.attributes), function (_, at) {
                    var n = at.name.toLowerCase(), v = at.value;
                    if (n === 'href' && el.tagName === 'A' && /^(https?:|mailto:)/i.test($.trim(v))) { return; }
                    if (n === 'style') {
                        var m = /text-align:\s*(\w+)/i.exec(v);
                        el.removeAttribute('style');
                        if (m && $.inArray(m[1].toLowerCase(), ALIGNS) > -1) { el.style.textAlign = m[1].toLowerCase(); }
                        return;
                    }
                    if (n === 'align' && $.inArray(v.toLowerCase(), ALIGNS) > -1) { return; }
                    el.removeAttribute(at.name);
                });
                if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
                clean(el);
            });
        })(doc.body);
        return doc.body.innerHTML;
    }

    /* =========================================================
       ۱) پاپ‌آور (فقط یکی در هر لحظه باز است)
    ========================================================= */
    var $pop = $('<div class="popover" role="dialog"></div>').hide().appendTo('body');
    var $anchor = null;

    function positionPopover() {
        if (!$anchor) { return; }
        var off = $anchor.offset();
        var aw = $anchor.outerWidth();
        var ah = $anchor.outerHeight();
        var pw = $pop.outerWidth();
        var ph = $pop.outerHeight();
        var $win = $(window);
        var left = off.left + aw / 2 - pw / 2;
        var maxLeft = $win.scrollLeft() + $win.width() - pw - 8;
        left = Math.max(8, Math.min(left, maxLeft));

        var top = off.top + ah + 8;
        var above = false;
        if (top + ph > $win.scrollTop() + $win.height() && off.top - ph - 8 > $win.scrollTop()) {
            top = off.top - ph - 8;
            above = true;
        }
        $pop.css({ top: top, left: left, '--arrow-x': (off.left + aw / 2 - left) + 'px' })
            .toggleClass('above', above);
    }

    function closePopover(returnFocus) {
        if (!$anchor) { return; }
        if ($anchor.is('[aria-expanded]')) { $anchor.attr('aria-expanded', 'false'); }
        if (returnFocus) { $anchor.trigger('focus'); }
        $pop.hide().empty();
        $anchor = null;
    }

    function openPopover($a, $content, onOpen) {
        // کلیک دوباره روی همان دکمه = بستن
        if ($anchor && $anchor[0] === $a[0]) { closePopover(); return; }
        closePopover();
        $anchor = $a;
        if ($a.is('[aria-expanded]')) { $a.attr('aria-expanded', 'true'); }
        $pop.empty().append($content).show();
        positionPopover();
        if (onOpen) { onOpen($pop); }
        positionPopover();
    }

    // بستن با کلیک بیرون / Esc / تغییر اندازه
    $(document).on('mousedown', function (e) {
        if (!$anchor) { return; }
        if ($(e.target).closest($pop).length || $(e.target).closest($anchor).length) { return; }
        closePopover();
    });
    $(document).on('keydown', function (e) {
        if (e.key === 'Escape' && $anchor) { closePopover(true); }
    });
    $(window).on('resize', positionPopover);
    $pop.on('click', '[data-close]', function () { closePopover(true); });

    /* ---------- توست ---------- */
    function showToast(msg, isError) {
        $('.toast').stop(true, true).remove();
        $('<div class="toast" role="status"></div>')
            .text(msg)
            .toggleClass('error', !!isError)
            .hide().appendTo('body')
            .fadeIn(150).delay(2600).fadeOut(250, function () { $(this).remove(); });
    }

    /* ---------- ابزارهای کمکی ---------- */
    function formatSize(bytes) {
        if (bytes >= 1048576) { return (bytes / 1048576).toLocaleString('fa-IR', { maximumFractionDigits: 1 }) + ' مگابایت'; }
        return Math.max(1, Math.round(bytes / 1024)).toLocaleString('fa-IR') + ' کیلوبایت';
    }

    function normalizeUrl(value) {
        value = $.trim(value);
        if (!value) { return null; }
        if (!/^[a-z][a-z0-9+.\-]*:/i.test(value)) { value = 'https://' + value; }
        try {
            var u = new URL(value);
            if (u.protocol === 'mailto:') { return u.href; }
            if ((u.protocol === 'http:' || u.protocol === 'https:') &&
                (u.hostname.indexOf('.') > -1 || u.hostname === 'localhost')) { return u.href; }
        } catch (err) { /* نامعتبر */ }
        return null;
    }

    function urlForm(title, placeholder, submitLabel) {
        return $(
            '<form class="pop-form" novalidate>' +
                '<p class="pop-title"></p>' +
                '<input type="url" dir="ltr" autocomplete="off">' +
                '<p class="pop-error" role="alert"></p>' +
                '<div class="pop-actions">' +
                    '<button type="submit" class="pop-btn primary"></button>' +
                    '<button type="button" class="pop-btn" data-close>انصراف</button>' +
                '</div>' +
            '</form>'
        ).find('.pop-title').text(title).end()
         .find('input').attr({ placeholder: placeholder, 'aria-label': title }).end()
         .find('.primary').text(submitLabel).end();
    }

    /* =========================================================
       ۲) ادیتور و نوار ابزار
    ========================================================= */
    var savedRange = null;

    function saveRange() {
        var sel = window.getSelection();
        if (sel.rangeCount) {
            var r = sel.getRangeAt(0);
            if ($editor[0].contains(r.commonAncestorContainer)) { savedRange = r.cloneRange(); }
        }
    }

    function restoreRange() {
        $editor.trigger('focus');
        if (savedRange) {
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedRange);
        }
    }

    function exec(cmd, value) {
        restoreRange();
        document.execCommand(cmd, false, value || null);
        $editor.trigger('input');
        saveRange();
        updateToolState();
    }

    function updateToolState() {
        var inEditor = $editor[0].contains(window.getSelection().anchorNode);
        var state = { underline: false, bold: false, italic: false, quote: false };
        if (inEditor) {
            try {
                state.underline = document.queryCommandState('underline');
                state.italic = document.queryCommandState('italic');
                state.bold = document.queryCommandState('bold');
                state.quote = String(document.queryCommandValue('formatBlock')).toLowerCase() === 'blockquote';
            } catch (err) { /* مرورگر پشتیبانی نمی‌کند */ }
        }
        $.each(state, function (cmd, on) {
            $('.tool-btn[data-cmd="' + cmd + '"]').toggleClass('active', on);
        });
    }

    // دکمه‌ها نباید انتخاب متن را از ادیتور بگیرند
    $('.toolbar').on('mousedown', '.tool-btn', function (e) { e.preventDefault(); });
    $(document).on('selectionchange', function () { saveRange(); updateToolState(); });

    // پاک‌کردن باقیمانده‌ی <br> وقتی ادیتور خالی می‌شود (برای نمایش placeholder)
    $editor.on('input', function () {
        var html = $editor.html();
        if (html === '<br>' || html === '') { $editor.empty(); }
        scheduleSave();
    });

    // چسباندن فقط به‌صورت متن ساده
    $editor.on('paste', function (e) {
        e.preventDefault();
        var text = (e.originalEvent.clipboardData || window.clipboardData).getData('text');
        document.execCommand('insertText', false, text);
    });

    $('.toolbar').on('click', '.tool-btn', function () {
        var $btn = $(this);
        switch ($btn.data('cmd')) {
            case 'underline': exec('underline'); break;
            case 'italic': exec('italic'); break;
            case 'bold': exec('bold'); break;
            case 'quote':
                var isQuote = String(document.queryCommandValue('formatBlock')).toLowerCase() === 'blockquote';
                exec('formatBlock', isQuote ? 'div' : 'blockquote');
                break;
            case 'link': openLinkPopover($btn); break;
            case 'align': openAlignPopover($btn); break;
        }
    });

    function openLinkPopover($btn) {
        saveRange();
        var $form = urlForm('افزودن پیوند', 'https://example.com', 'افزودن');
        openPopover($btn, $form, function () {
            $form.find('input').trigger('focus');
        });
        $form.on('submit', function (e) {
            e.preventDefault();
            var url = normalizeUrl($form.find('input').val());
            if (!url) { $form.find('.pop-error').text('نشانی واردشده معتبر نیست.'); return; }
            restoreRange();
            var sel = window.getSelection();
            if (sel.isCollapsed) {
                var $a = $('<a></a>').attr('href', url).text(url);
                document.execCommand('insertHTML', false, $('<div>').append($a).html());
            } else {
                document.execCommand('createLink', false, url);
            }
            $editor.find('a').attr({ target: '_blank', rel: 'noopener noreferrer' });
            $editor.trigger('input');
            closePopover();
        });
    }

    function openAlignPopover($btn) {
        var options = [
            ['justifyRight', 'راست‌چین'],
            ['justifyCenter', 'وسط‌چین'],
            ['justifyLeft', 'چپ‌چین'],
            ['justifyFull', 'تراز دوطرفه']
        ];
        var $list = $('<ul class="pop-list"></ul>');
        $.each(options, function (_, o) {
            $('<li></li>').append($('<button type="button"></button>').attr('data-align', o[0]).text(o[1])).appendTo($list);
        });
        var $box = $('<div></div>').append($list);
        $box.css('min-width', '140px');
        openPopover($btn, $box);
        $list.on('mousedown', 'button', function (e) { e.preventDefault(); });
        $list.on('click', 'button', function () {
            exec($(this).data('align'));
            closePopover();
        });
    }

    /* =========================================================
       ۳) منشن
    ========================================================= */
    function mentionedIds() {
        return $('#mentionBox .user-tag:not(.removing)').map(function () { return Number($(this).data('user-id')); }).get();
    }

    function addMention(user, instant) {
        if ($.inArray(user.id, mentionedIds()) > -1) { return; }
        var $tag = $('<div class="user-tag"></div>').attr('data-user-id', user.id)
            .append($('<span class="avatar"></span>').append($('<img>').attr({ src: AVATAR, alt: user.name })))
            .append($('<span class="name2"></span>').text(user.name))
            .append($('<button class="close" type="button"></button>')
                .attr('aria-label', 'حذف منشن').html(closeIconHtml));
        if (instant) { $tag.insertBefore('#addMention'); }
        else { $tag.hide().insertBefore('#addMention').fadeIn(150); }
        scheduleSave();
    }

    $('#mentionBox').on('click', '.close', function () {
        var $tag = $(this).closest('.user-tag').addClass('removing');
        scheduleSave();
        setTimeout(function () { $tag.remove(); }, 150);
    });

    $('#addMention').on('click', function () {
        var $box = $(
            '<div>' +
                '<p class="pop-title">افزودن منشن</p>' +
                '<input type="search" placeholder="جستجوی نام…" aria-label="جستجوی کاربر" autocomplete="off">' +
                '<ul class="pop-list"></ul>' +
            '</div>'
        );
        var $list = $box.find('.pop-list');

        function render(query) {
            var taken = mentionedIds();
            var q = $.trim(query || '');
            var found = $.grep(USERS, function (u) {
                return $.inArray(u.id, taken) === -1 && u.name.indexOf(q) > -1;
            });
            $list.empty();
            if (!found.length) {
                $list.append($('<li class="pop-empty"></li>').text('کاربری پیدا نشد.'));
            }
            $.each(found, function (_, u) {
                $('<li></li>').append(
                    $('<button type="button"></button>').attr('data-id', u.id)
                        .append($('<img>').attr({ src: AVATAR, alt: '' }))
                        .append($('<span></span>').text(u.name))
                ).appendTo($list);
            });
            positionPopover();
        }

        openPopover($(this), $box, function () {
            render('');
            $box.find('input').trigger('focus');
        });
        $box.find('input').on('input', function () { render($(this).val()); });
        $list.on('click', 'button', function () {
            var id = Number($(this).data('id'));
            addMention($.grep(USERS, function (u) { return u.id === id; })[0]);
            closePopover(true);
        });
    });

    /* =========================================================
       ۴) فایل / سند
    ========================================================= */
    var attachments = [];   // { id, file, name, preview }
    var nextId = 1;

    // نمایش/مخفی‌کردن بخش بارگذاری
    function toggleUpload() {
        var $t = $('#fileToggle');
        var open = $t.attr('aria-expanded') === 'true';
        $t.attr('aria-expanded', String(!open));
        $('#uploadArea').slideToggle(200);
        scheduleSave();
    }
    $('#fileToggle').on('click', toggleUpload);

    // دسترسی‌پذیری: Enter و Space برای المان‌های role=button
    $('.after-mention, .send-link, .sendfile, .send-img').on('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

    function renderAttachments() {
        var $list = $('#fileList').empty();
        $.each(attachments, function (_, a) {
            var $li = $('<li class="file-item"></li>').attr('data-id', a.id);
            if (/^image\//.test(a.file.type)) {
                $li.append($('<img>').attr({ src: a.preview, alt: '' }));
            }
            $li.append($('<span class="file-name"></span>').text(a.name).attr('title', a.name));
            $li.append($('<span class="file-size"></span>').text(formatSize(a.file.size)));
            $li.append($('<button type="button" class="file-remove"></button>').attr('aria-label', 'حذف ' + a.name).text('×'));
            $list.append($li);
        });
    }

    function addFiles(fileList) {
        $.each(fileList, function (_, f) {
            var ext = (f.name.split('.').pop() || '').toLowerCase();
            if ($.inArray(ext, ALLOWED_EXT) === -1) {
                showToast('«' + f.name + '»: فرمت پشتیبانی نمی‌شود.', true); return;
            }
            if (f.size > MAX_FILE_SIZE) {
                showToast('«' + f.name + '»: حجم فایل بیش از ۱۰ مگابایت است.', true); return;
            }
            var dup = $.grep(attachments, function (a) {
                return a.file.name === f.name && a.file.size === f.size;
            }).length;
            if (dup) { showToast('«' + f.name + '» قبلاً اضافه شده است.', true); return; }
            var att = {
                id: nextId++, file: f, name: f.name,
                preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null
            };
            attachments.push(att);
            dbPut('files', { id: att.id, name: f.name, type: f.type, size: f.size, blob: f }).catch(dbFail);
        });
        renderAttachments();
        scheduleSave();
    }

    function removeAttachment(id) {
        attachments = $.grep(attachments, function (a) {
            if (a.id === id && a.preview) { URL.revokeObjectURL(a.preview); }
            return a.id !== id;
        });
        dbDel('files', id).catch(dbFail);
        renderAttachments();
        scheduleSave();
    }

    $('#fileList').on('click', '.file-remove', function () {
        removeAttachment(Number($(this).closest('.file-item').data('id')));
    });

    // انتخاب از دستگاه
    $('#dropZone').on('click', function () { $('#fileInput')[0].click(); });
    $('#cameraOpt').on('click', function () { $('#imageInput')[0].click(); });
    $('#fileInput, #imageInput').on('change', function () {
        addFiles(this.files);
        this.value = '';
    });

    // کشیدن و رها کردن
    $('#dropZone').on('dragenter dragover', function (e) {
        e.preventDefault();
        $(this).addClass('dragover');
    }).on('dragleave drop', function (e) {
        e.preventDefault();
        $(this).removeClass('dragover');
        if (e.type === 'drop') { addFiles(e.originalEvent.dataTransfer.files); }
    });
    // جلوگیری از باز شدن فایل در مرورگر وقتی بیرون از ناحیه رها می‌شود
    $(document).on('dragover drop', function (e) { e.preventDefault(); });

    // QR بارگذاری از موبایل (فقط راهنما؛ تولید لینک/QR واقعی نیاز به سرور دارد)
    $('#qrOpt').on('click', function () {
        var $box = $(
            '<div>' +
                '<p class="pop-title">بارگذاری با موبایل</p>' +
                '<p>کد QR را با دوربین گوشی اسکن کنید و سند را از موبایل بفرستید.</p>' +
                '<div class="pop-actions"><button type="button" class="pop-btn" data-close>متوجه شدم</button></div>' +
            '</div>'
        );
        openPopover($(this), $box);
    });

    /* =========================================================
       ۵) تب‌ها و ضبط صدا
    ========================================================= */
    function setTab(tab) {
        currentTab = tab;
        $('#tabsForm button').each(function () {
            var on = $(this).data('tab') === tab;
            $(this).toggleClass('active', on).attr('aria-pressed', String(on));
        });
        $('.feedback-container').toggle(tab === 'text');
        $('#voicePanel').prop('hidden', tab !== 'voice');
        if (tab !== 'voice' && recorder && recorder.state === 'recording') { stopRecording(); }
        closePopover();
        scheduleSave();
    }

    $('#tabsForm').on('submit', function (e) { e.preventDefault(); });
    $('#tabsForm').on('click', 'button', function (e) {
        e.preventDefault();
        setTab($(this).data('tab'));
    });

    var recorder = null, stream = null, chunks = [], recBlob = null, recUrl = null;
    var timerId = null, startTs = 0;

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function tick() {
        var s = Math.floor((Date.now() - startTs) / 1000);
        $('#recTimer').text(pad(Math.floor(s / 60)) + ':' + pad(s % 60));
    }

    function clearRecording() {
        if (recUrl) { URL.revokeObjectURL(recUrl); }
        recBlob = null; recUrl = null;
        $('#recAudio').attr('src', '').prop('hidden', true);
        $('#recDelete').prop('hidden', true);
        $('#recTimer').text('00:00');
        dbDel('kv', 'recording').catch(function () { /* مهم نیست */ });
    }

    function startRecording() {
        if (!navigator.mediaDevices || !window.MediaRecorder) {
            showToast('مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.', true); return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
            clearRecording();
            stream = s; chunks = [];
            recorder = new MediaRecorder(s);
            recorder.ondataavailable = function (e) { if (e.data && e.data.size) { chunks.push(e.data); } };
            recorder.onstop = function () {
                stream.getTracks().forEach(function (t) { t.stop(); });
                recBlob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
                recUrl = URL.createObjectURL(recBlob);
                $('#recAudio').attr('src', recUrl).prop('hidden', false);
                $('#recDelete').prop('hidden', false);
                dbPut('kv', { blob: recBlob, timer: $('#recTimer').text() }, 'recording').catch(dbFail);
            };
            recorder.start();
            startTs = Date.now();
            $('#recTimer').text('00:00');
            timerId = setInterval(tick, 250);
            $('#recBtn').addClass('recording').attr('aria-pressed', 'true').find('.rec-label').text('توقف ضبط');
        }).catch(function () {
            showToast('دسترسی به میکروفون ممکن نشد.', true);
        });
    }

    function stopRecording() {
        clearInterval(timerId);
        if (recorder && recorder.state === 'recording') { tick(); }
        if (recorder && recorder.state === 'recording') { recorder.stop(); }
        $('#recBtn').removeClass('recording').attr('aria-pressed', 'false').find('.rec-label').text('ضبط مجدد');
    }

    $('#recBtn').on('click', function () {
        if (recorder && recorder.state === 'recording') { stopRecording(); } else { startRecording(); }
    });
    $('#recDelete').on('click', function () {
        clearRecording();
        $('#recBtn').find('.rec-label').text('شروع ضبط');
    });

    /* =========================================================
       ۶) ثبت و بستن فرم
    ========================================================= */
    function resetForm() {
        $editor.empty();
        $.each(attachments, function (_, a) { if (a.preview) { URL.revokeObjectURL(a.preview); } });
        attachments = [];
        renderAttachments();
        dbClear('files').catch(function () { /* مهم نیست */ });
        clearRecording();
        $('#recBtn').find('.rec-label').text('شروع ضبط');
        setTab('text');
    }

    $('#submitForm').on('submit', function (e) {
        e.preventDefault();
        var text = $.trim($editor.text());
        if (currentTab === 'text' && !text) {
            showToast('لطفاً متن بازخورد را وارد کنید.', true);
            $editor.trigger('focus');
            return;
        }
        if (currentTab === 'voice') {
            if (recorder && recorder.state === 'recording') { stopRecording(); }
            if (!recBlob) { showToast('لطفاً ابتدا صدای خود را ضبط کنید.', true); return; }
        }
        var payload = {
            type: currentTab,
            html: currentTab === 'text' ? $editor.html() : null,
            text: currentTab === 'text' ? text : null,
            audio: currentTab === 'voice' ? recBlob : null,
            mentions: mentionedIds(),
            attachments: $.map(attachments, function (a) {
                return { name: a.name, file: a.file };
            })
        };
        // ذخیره‌ی ماندگار بازخورد ثبت‌شده؛ اگر ذخیره نشد فرم دست‌نخورده می‌ماند
        var record = {
            created: Date.now(),
            type: payload.type,
            html: payload.html,
            text: payload.text,
            mentions: payload.mentions,
            audio: payload.audio,
            attachments: $.map(attachments, function (a) {
                return { name: a.name, type: a.file.type, size: a.file.size, blob: a.file };
            })
        };
        dbPut('feedbacks', record).then(function () {
            // اینجا را به سرور وصل کنید؛ مثلاً با $.ajax یا FormData
            $(document).trigger('feedback:submit', [payload]);
            showToast('بازخورد با موفقیت ثبت شد.');
            resetForm();
            renderHistory();
        }).catch(function () {
            showToast('ثبت بازخورد ممکن نشد؛ ذخیره‌سازی مرورگر در دسترس نیست.', true);
        });
    });

    // دکمه بستن با تأیید
    $('#closeBtn').on('click', function () {
        var $box = $(
            '<div>' +
                '<p class="pop-title">بستن فرم؟</p>' +
                '<p>اطلاعات واردشده حفظ می‌شود و با «نمایش دوباره فرم» برمی‌گردد.</p>' +
                '<div class="pop-actions">' +
                    '<button type="button" class="pop-btn primary" data-confirm>بستن</button>' +
                    '<button type="button" class="pop-btn" data-close>انصراف</button>' +
                '</div>' +
            '</div>'
        );
        openPopover($(this), $box, function () { $box.find('[data-confirm]').trigger('focus'); });
        $box.on('click', '[data-confirm]', function () {
            closePopover();
            formClosed = true;
            saveDraft();
            $('.layout').fadeOut(200, showReopen);
        });
    });

    function showReopen() {
        if ($('.reopen').length) { return; }
        $('<button type="button" class="reopen">نمایش دوباره فرم</button>')
            .appendTo('body')
            .on('click', function () {
                $(this).remove();
                formClosed = false;
                saveDraft();
                $('.layout').fadeIn(200);
            });
    }

    /* =========================================================
       ۷) بازخوردهای ثبت‌شده + بازیابی بعد از رفرش
    ========================================================= */
    var historyUrls = [];

    function renderHistory() {
        return dbAll('feedbacks').then(function (list) {
            $.each(historyUrls, function (_, u) { URL.revokeObjectURL(u); });
            historyUrls = [];
            var $list = $('#historyList').empty();
            list.sort(function (a, b) { return b.created - a.created; });
            $.each(list, function (_, r) {
                var $li = $('<li class="history-item"></li>').attr('data-id', r.id);
                var when = new Date(r.created).toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
                var $head = $('<div class="history-meta"></div>')
                    .append($('<span></span>').text(r.type === 'voice' ? 'بازخورد صوتی' : 'بازخورد متنی'))
                    .append($('<span></span>').text(when))
                    .append($('<button type="button" class="history-remove"></button>').text('حذف'));
                $li.append($head);
                if (r.type === 'voice' && r.audio) {
                    var au = URL.createObjectURL(r.audio); historyUrls.push(au);
                    $li.append($('<audio controls></audio>').attr('src', au));
                } else {
                    $li.append($('<div class="history-body"></div>').html(sanitizeHtml(r.html || '')));
                }
                var names = $.map(r.mentions || [], function (id) {
                    var u = $.grep(USERS, function (x) { return x.id === id; })[0];
                    return u ? u.name : null;
                });
                if (names.length) { $li.append($('<p class="history-extra"></p>').text('منشن: ' + names.join('، '))); }
                if (r.attachments && r.attachments.length) {
                    var $files = $('<p class="history-extra"></p>').text('پیوست: ');
                    $.each(r.attachments, function (i, f) {
                        var fu = URL.createObjectURL(f.blob); historyUrls.push(fu);
                        if (i) { $files.append('، '); }
                        $files.append($('<a></a>').attr({ href: fu, download: f.name }).text(f.name));
                    });
                    $li.append($files);
                }
                $list.append($li);
            });
            $('#history').prop('hidden', !list.length);
        }).catch(function () { /* بدون ذخیره‌سازی، تاریخچه‌ای نیست */ });
    }

    $('#historyList').on('click', '.history-remove', function () {
        var id = Number($(this).closest('.history-item').data('id'));
        dbDel('feedbacks', id).then(renderHistory).catch(dbFail);
    });

    function restoreFiles(minNextId) {
        return dbAll('files').then(function (rows) {
            rows.sort(function (a, b) { return a.id - b.id; });
            $.each(rows, function (_, r) {
                var f = new File([r.blob], r.name, { type: r.type });
                attachments.push({ id: r.id, file: f, name: r.name, preview: /^image\//.test(r.type) ? URL.createObjectURL(f) : null });
                nextId = Math.max(nextId, r.id + 1);
            });
            nextId = Math.max(nextId, minNextId || 1);
            renderAttachments();
        }).catch(function () { /* چیزی برای بازیابی نیست */ });
    }

    function restoreRecording() {
        return dbGet('kv', 'recording').then(function (rec) {
            if (!rec || !rec.blob) { return; }
            recBlob = rec.blob;
            recUrl = URL.createObjectURL(recBlob);
            $('#recAudio').attr('src', recUrl).prop('hidden', false);
            $('#recDelete').prop('hidden', false);
            $('#recTimer').text(rec.timer || '00:00');
            $('#recBtn').find('.rec-label').text('ضبط مجدد');
        }).catch(function () { /* چیزی برای بازیابی نیست */ });
    }

    function restoreDraft() {
        var st = null;
        try { st = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (err) { st = null; }
        if (st) {
            if (typeof st.html === 'string') { $editor.html(sanitizeHtml(st.html)); }
            if ($.isArray(st.mentions)) {
                $('#mentionBox .user-tag').remove();
                $.each(st.mentions, function (_, id) {
                    var u = $.grep(USERS, function (x) { return x.id === Number(id); })[0];
                    if (u) { addMention(u, true); }
                });
            }
            if (st.uploadOpen === false) {
                $('#uploadArea').hide();
                $('#fileToggle').attr('aria-expanded', 'false');
            }
            if (st.tab === 'voice') { setTab('voice'); }
            if (st.closed) { formClosed = true; $('.layout').hide(); showReopen(); }
        }
        restoring = false;
        $.when(restoreFiles(st && st.nextId), restoreRecording(), renderHistory()).always(saveDraft);
    }

    restoreDraft();
});
