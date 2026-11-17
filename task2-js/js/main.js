$(function () {
    'use strict';

    /* ---------- ثابت‌ها و وضعیت ---------- */
    var CARD = '.feedback-card, .feedback-toolbar2, .feedback-toolbar3';
    var COLOR_PLAYED = '#132D84';
    var COLOR_IDLE = '#DDE1F0';
    var BAR_STEP = 7;           // فاصله‌ی افقی هر میله‌ی موج صوتی (px)
    var TXT_UNCONFIRMED = 'تایید نشده';
    var TXT_CONFIRMED = 'تایید شده';

    var $panel = $('#panel-feedbacks');
    var $toast = $('#toast');
    var initialHTML = $panel.html();                 // برای دکمه‌ی بازنشانی
    var actionIconsHTML = $('.feedback-toolbar2 .action-icons').first().prop('outerHTML');
    // قالب کارت ویس (قبل از اولین initPlayer برداشته می‌شود تا SVG موج صوتی دست‌نخورده باشد)
    var voiceTemplateHTML = $('<div>').html(initialHTML).find('.feedback-toolbar3').first().prop('outerHTML');
    var logs = [];
    var toastTimer = null;

    var MAX_REC_SEC = 300;      // حداکثر مدت ضبط (۵ دقیقه)
    var MIN_REC_SEC = 1;        // کوتاه‌تر از این ثبت نمی‌شود
    var rec = null;             // ضبطِ در حال انجام
    var pendingVoice = null;    // ویس ضبط‌شده‌ای که هنوز ثبت نشده
    var recToken = 0;           // برای نادیده گرفتن درخواست‌های میکروفونِ لغوشده

    /* ---------- ابزارهای کمکی ---------- */
    var faDigits = '۰۱۲۳۴۵۶۷۸۹';
    function toFa(value) {
        return String(value).replace(/\d/g, function (d) { return faDigits[d]; });
    }

    function formatTime(sec) {
        sec = Math.max(0, Math.round(sec));
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return toFa(m + ':' + (s < 10 ? '0' + s : s));
    }

    function showToast(msg) {
        clearTimeout(toastTimer);
        $toast.stop(true, true).text(msg).hide().fadeIn(150);
        toastTimer = setTimeout(function () { $toast.fadeOut(250); }, 2500);
    }

    function userName($card) {
        return $.trim($card.find('.user-name, .toolbar2-name').first().text()) || 'کاربر';
    }

    function addLog(text) {
        logs.unshift({ text: text, time: new Date() });
        renderLogs();
    }

    function renderLogs() {
        var $list = $('#logsList').empty();
        $.each(logs, function (_, item) {
            var $li = $('<li>').append($('<span>').text(item.text))
                .append($('<time>').text(item.time.toLocaleTimeString('fa-IR')));
            $list.append($li);
        });
        $('#logsEmpty').prop('hidden', logs.length > 0);
    }

    function renderAttachments() {
        var $list = $('#attachList').empty();
        $panel.find('.toolbar2-image').each(function () {
            var src = $(this).attr('src');
            var name = src.split('/').pop();
            $list.append(
                $('<li>')
                    .append($('<img>').attr({ src: src, alt: name }))
                    .append($('<span>').text(name))
                    .append($('<span class="attach-kind">').text('تصویر'))
            );
        });
        $panel.find('.audio-player').each(function () {
            var st = $(this).data('state');
            var dur = Number($(this).find('.audio-time').data('duration')) || 0;
            var $li = $('<li>')
                .append($('<span>').text('پیام صوتی'))
                .append($('<span class="attach-kind">').text(formatTime(dur)));
            if (st && st.url) {
                $li.append($('<a class="attach-link">').text('دانلود')
                    .attr({ href: st.url, download: st.filename }));
            }
            $list.append($li);
        });
        $('#attachEmpty').prop('hidden', $list.children().length > 0);
    }

    function updateEmpty() {
        $('#feedbacksEmpty').prop('hidden', $panel.find(CARD).length > 0);
    }

    /* ---------- تب‌ها ---------- */
    $('.tabs-list').on('click', 'button[data-tab]', function () {
        var $btn = $(this);
        var name = $btn.data('tab');
        if ($btn.hasClass('active')) { return; }

        $btn.addClass('active').attr('aria-selected', 'true')
            .siblings().removeClass('active').attr('aria-selected', 'false');

        $('.tab-panel').prop('hidden', true);
        if (name === 'logs') { renderLogs(); }
        if (name === 'attachments') { renderAttachments(); }
        $('#panel-' + name).hide().prop('hidden', false).fadeIn(180);
    });

    // جابه‌جایی بین تب‌ها با کلیدهای جهت‌دار
    $('.tabs-list').on('keydown', 'button[data-tab]', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') { return; }
        var $tabs = $('.tabs-list button[data-tab]');
        var i = $tabs.index(this);
        // در صفحه‌ی راست‌به‌چپ، کلید چپ یعنی تب بعدی
        i += (e.key === 'ArrowLeft') ? 1 : -1;
        $tabs.eq((i + $tabs.length) % $tabs.length).focus().trigger('click');
        e.preventDefault();
    });

    /* ---------- بازخورد جدید ---------- */
    function toggleNewForm(show) {
        var $newForm = $('#newFeedbackForm');
        if (show === undefined) { show = $newForm.prop('hidden'); }
        $('.add-feedback-btn').attr('aria-expanded', show);
        if (show) {
            $newForm.hide().prop('hidden', false).slideDown(160, function () {
                $newForm.find('textarea').trigger('focus');
            });
        } else {
            resetVoice();
            $newForm.slideUp(140, function () { $newForm.prop('hidden', true); });
        }
    }

    $panel.on('click', '[data-action="add"]', function () { toggleNewForm(); });
    $panel.on('click', '[data-action="cancel-add"]', function () { toggleNewForm(false); });

    $panel.on('submit', '#newFeedbackForm', function (e) {
        e.preventDefault();
        var $newForm = $(this);
        var $ta = $newForm.find('textarea');
        var text = $.trim($ta.val());

        if (rec) {
            showToast('ابتدا ضبط ویس را پایان دهید.');
            return;
        }
        if (!text && !pendingVoice) {
            showToast('متن بازخورد را وارد کنید یا ویس ضبط کنید.');
            $ta.trigger('focus');
            return;
        }

        if (pendingVoice) {
            submitVoiceFeedback($newForm, text);
            return;
        }

        var $card = $(
            '<div class="feedback-toolbar2 is-new">' +
                '<div class="toolbar2-header">' +
                    '<div class="toolbar2-user"><span class="toolbar2-user-name">' +
                        '<img class="user-avatar" src="./img/img-dr.png" alt="">' +
                        '<span class="toolbar2-name"></span></span></div>' +
                    '<div class="toolbar2-actions">' + actionIconsHTML +
                        '<div class="status-badge badge-red"><span class="white-dot"></span>' +
                        '<span>' + TXT_UNCONFIRMED + '</span></div>' +
                    '</div>' +
                '</div>' +
                '<hr class="line-divider3">' +
                '<div class="toolbar2-txt"></div>' +
            '</div>'
        );
        $card.find('.toolbar2-name').text('شما');
        $card.find('.toolbar2-txt').text(text);

        $newForm.after($card.hide());
        $card.slideDown(220);
        $ta.val('');
        toggleNewForm(false);
        updateEmpty();
        addLog('بازخورد جدید ثبت شد.');
        showToast('بازخورد ثبت شد.');
    });

    /* ---------- حذف ---------- */
    $panel.on('click', '.icon-btn[data-action="delete"]', function () {
        var $card = $(this).closest(CARD);
        deleteCard($card);
    });

    function deleteCard($card) {
        if (!window.confirm('این بازخورد حذف شود؟')) { return; }
        var who = userName($card);
        stopAudioIn($card);
        $card.slideUp(220, function () {
            $card.remove();
            updateEmpty();
        });
        addLog('بازخورد «' + who + '» حذف شد.');
    }

    /* ---------- ویرایش ---------- */
    function textTargets($card) {
        return $card.find('.user-mention > span, .toolbar2-txt');
    }

    function startEdit($card) {
        var $targets = textTargets($card);
        if (!$targets.length) {
            showToast('این مورد متنی برای ویرایش ندارد.');
            return;
        }
        if ($card.hasClass('is-editing')) { return; }

        $card.addClass('is-editing');
        $targets.each(function () {
            $(this).data('orig', $(this).text()).attr('contenteditable', 'true');
        });
        $targets.first().trigger('focus');

        $('<div class="edit-bar">' +
            '<button type="button" class="btn btn-primary" data-action="save-edit">ذخیره</button>' +
            '<button type="button" class="btn btn-ghost" data-action="cancel-edit">انصراف</button>' +
          '</div>').appendTo($card);
    }

    function endEdit($card, save) {
        textTargets($card).each(function () {
            var $t = $(this);
            if (save) {
                // فقط متن ساده نگه داشته می‌شود
                $t.text($.trim($t.text()));
            } else {
                $t.text($t.data('orig'));
            }
            $t.removeAttr('contenteditable').removeData('orig');
        });
        $card.removeClass('is-editing').children('.edit-bar').remove();
        if (save) {
            addLog('بازخورد «' + userName($card) + '» ویرایش شد.');
            showToast('تغییرات ذخیره شد.');
        }
    }

    $panel.on('click', '.icon-btn[data-action="edit"]', function () {
        startEdit($(this).closest(CARD));
    });
    $panel.on('click', '[data-action="save-edit"]', function () {
        endEdit($(this).closest(CARD), true);
    });
    $panel.on('click', '[data-action="cancel-edit"]', function () {
        endEdit($(this).closest(CARD), false);
    });
    $panel.on('keydown', '[contenteditable="true"]', function (e) {
        if (e.key === 'Escape') { endEdit($(this).closest(CARD), false); }
    });

    /* ---------- پاسخ ---------- */
    function toggleReplyForm($card) {
        var $existing = $card.children('.card-form');
        if ($existing.length) {
            $existing.slideUp(140, function () { $existing.remove(); });
            return;
        }
        var $form = $(
            '<form class="inline-form card-form">' +
                '<label class="inline-form-label">پاسخ شما</label>' +
                '<textarea rows="2" maxlength="500" placeholder="پاسخ را بنویسید..."></textarea>' +
                '<div class="inline-form-actions">' +
                    '<button type="submit" class="btn btn-primary">ارسال پاسخ</button>' +
                    '<button type="button" class="btn btn-ghost" data-action="cancel-reply">انصراف</button>' +
                '</div>' +
            '</form>'
        );
        $form.hide().appendTo($card).slideDown(160, function () {
            $form.find('textarea').trigger('focus');
        });
    }

    $panel.on('click', '.icon-btn[data-action="reply"]', function () {
        toggleReplyForm($(this).closest(CARD));
    });

    $panel.on('click', '[data-action="cancel-reply"]', function () {
        var $form = $(this).closest('.card-form');
        $form.slideUp(140, function () { $form.remove(); });
    });

    $panel.on('submit', '.card-form', function (e) {
        e.preventDefault();
        var $form = $(this);
        var $card = $form.closest(CARD);
        var text = $.trim($form.find('textarea').val());
        if (!text) {
            showToast('متن پاسخ را وارد کنید.');
            return;
        }
        var $replies = $card.children('.replies');
        if (!$replies.length) { $replies = $('<div class="replies">').appendTo($card); }

        var $item = $(
            '<div class="reply-wrapper">' +
                '<span class="reply-badge">پاسخ:</span>' +
                '<div class="reply-banner"><span class="reply-text" style="white-space:normal"></span></div>' +
            '</div>'
        );
        $item.find('.reply-text').text(text);
        $replies.append($item.hide());
        $item.slideDown(160);
        $form.slideUp(140, function () { $form.remove(); });
        addLog('به بازخورد «' + userName($card) + '» پاسخ داده شد.');
    });

    /* ---------- وضعیت (تایید / عدم تایید) ---------- */
    $panel.on('click', '.status-badge', function () {
        var $b = $(this);
        var confirmed = $b.hasClass('badge-green');
        $b.toggleClass('badge-red', confirmed).toggleClass('badge-green', !confirmed);
        $b.children('span').last().text(confirmed ? TXT_UNCONFIRMED : TXT_CONFIRMED);
        addLog('وضعیت بازخورد «' + userName($b.closest(CARD)) + '» به «' +
            (confirmed ? TXT_UNCONFIRMED : TXT_CONFIRMED) + '» تغییر کرد.');
    });

    $panel.on('click', '.status-toolbar3', function () {
        var $b = $(this);
        var unconfirmed = $b.hasClass('is-unconfirmed');
        $b.toggleClass('is-unconfirmed', !unconfirmed);
        $b.children('span').last().text(unconfirmed ? TXT_CONFIRMED : TXT_UNCONFIRMED);
        addLog('وضعیت بازخورد «' + userName($b.closest(CARD)) + '» به «' +
            (unconfirmed ? TXT_CONFIRMED : TXT_UNCONFIRMED) + '» تغییر کرد.');
    });

    /* آیکون‌های کارت ویس یک SVG واحد هستند؛ با موقعیت کلیک تشخیص می‌دهیم کدام آیکون است */
    $panel.on('click', '.icon-toolbar3 > svg', function (e) {
        var rect = this.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;      // 0..1 از چپ
        var $card = $(this).closest(CARD);
        if (x < 0.33) { deleteCard($card); }
        else if (x < 0.66) { startEdit($card); }
        else { toggleReplyForm($card); }
    });

    /* ---------- نوار ابزار: بازنشانی / چاپ / PDF / اکسل ---------- */
    $panel.on('click', '.icon-btn[data-action="reset"]', function () {
        if (!window.confirm('همه‌ی تغییرات به حالت اولیه برگردد؟')) { return; }
        resetVoice();
        stopAllAudio();
        $panel.html(initialHTML);
        $('.audio-player').each(function () { initPlayer($(this)); });
        updateEmpty();
        addLog('صفحه به حالت اولیه بازنشانی شد.');
        showToast('بازنشانی انجام شد.');
    });

    $panel.on('click', '.icon-btn[data-action="print"]', function () {
        window.print();
    });

    $panel.on('click', '.icon-btn[data-action="pdf"]', function () {
        showToast('در پنجره‌ی چاپ، مقصد را «Save as PDF» انتخاب کنید.');
        setTimeout(function () { window.print(); }, 600);
    });

    $panel.on('click', '.icon-btn[data-action="excel"]', function () {
        var rows = [['کاربر', 'نوع', 'وضعیت', 'متن']];
        $panel.find(CARD).each(function () {
            var $c = $(this);
            var isVoice = $c.hasClass('feedback-toolbar3');
            var status = $.trim($c.find('.status-badge, .status-toolbar3').first().text());
            var text = $.trim(textTargets($c).map(function () {
                return $.trim($(this).text());
            }).get().join(' | '));
            rows.push([userName($c), isVoice ? 'ویس' : 'متن', status, text]);
        });

        var csv = $.map(rows, function (r) {
            return $.map(r, function (cell) {
                return '"' + String(cell).replace(/"/g, '""') + '"';
            }).join(',');
        }).join('\r\n');

        // BOM برای نمایش درست فارسی در اکسل
        var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var $a = $('<a>').attr({ href: url, download: 'feedbacks.csv' }).appendTo('body');
        $a[0].click();
        $a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        addLog('خروجی اکسل (CSV) گرفته شد.');
    });

    /* ---------- پخش‌کننده‌ی ویس ---------- */
    var players = [];     // وضعیت هر پلیر
    var ICON_PLAY = '<path class="play-glyph" d="M15.2 11.6 26.6 18.9 15.2 26.2Z" fill="white" stroke="white" stroke-width="2" stroke-linejoin="round"/>';
    var ICON_PAUSE = '<rect class="play-glyph" x="12.6433" y="11.3171" width="4.46241" height="15.0914" rx="2" fill="white"/>' +
                     '<rect class="play-glyph" x="20.0807" y="11.3171" width="4.46241" height="15.0914" rx="2" fill="white"/>';

    function initPlayer($player, opts) {
        opts = opts || {};
        var $svg = $player.find('.waveform');
        var $wrap = $player.find('.waveform-container');
        var $time = $player.find('.audio-time');

        // الگوی ارتفاع میله‌ها را از SVG اصلی می‌خوانیم
        var pattern = $svg.data('pattern');
        if (!pattern) {
            pattern = $svg.find('rect').map(function () {
                return { x: +$(this).attr('x') || 0, y: +$(this).attr('y') || 0, h: +$(this).attr('height') };
            }).get().sort(function (a, b) { return a.x - b.x; });
            $svg.data('pattern', pattern);
        }

        var state = {
            $player: $player, $svg: $svg, $wrap: $wrap, $time: $time,
            $btn: $player.find('.play-btn'),
            duration: Number($time.data('duration')) || 201,
            position: 0, timer: null, bars: 0,
            peaks: opts.peaks || null,       // موج واقعیِ صدای ضبط‌شده
            audio: opts.audio || null,       // برای ویس واقعی؛ در ویس نمونه null است (شبیه‌سازی)
            url: opts.url || null,
            filename: opts.filename || null
        };
        $player.data('state', state);
        if ($.inArray(state, players) === -1) { players.push(state); }

        if (state.audio) { bindAudio(state); }
        buildWaveform(state);
        paint(state);
    }

    // اتصال المان صدا به پلیر: پایان پخش و مدت واقعی
    function bindAudio(state) {
        var audio = state.audio;
        prepareAudio(audio, function (d) {
            state.duration = d;
            state.$time.data('duration', d);
            paint(state);
        });
        audio.addEventListener('ended', function () {
            state.position = 0;
            try { audio.currentTime = 0; } catch (err) { /* بی‌اهمیت */ }
            pause(state);
            paint(state);
        });
    }

    /*
     * فایل‌های MediaRecorder در کروم معمولاً مدت (duration) ندارند و جابه‌جایی در آن‌ها درست کار نمی‌کند.
     * با پرش به یک زمان خیلی بزرگ، مرورگر مدت واقعی را حساب می‌کند؛ بعد به ابتدا برمی‌گردیم.
     */
    function prepareAudio(audio, onDuration) {
        function report() {
            if (isFinite(audio.duration) && audio.duration > 0 && onDuration) { onDuration(audio.duration); }
        }
        audio.preload = 'metadata';
        audio.addEventListener('loadedmetadata', function () {
            if (audio.duration === Infinity || isNaN(audio.duration)) {
                var onTime = function () {
                    audio.removeEventListener('timeupdate', onTime);
                    audio.currentTime = 0;
                    report();
                };
                audio.addEventListener('timeupdate', onTime);
                audio.currentTime = 1e101;
            } else {
                report();
            }
        });
    }

    function buildWaveform(state) {
        var width = Math.max(state.$wrap.width(), BAR_STEP * 10);
        var pattern = state.$svg.data('pattern');
        var count = Math.floor(width / BAR_STEP);
        var svgNS = 'http://www.w3.org/2000/svg';
        var svg = state.$svg[0];

        while (svg.firstChild) { svg.removeChild(svg.firstChild); }
        svg.setAttribute('viewBox', '0 0 ' + width + ' 21');
        svg.setAttribute('preserveAspectRatio', 'none');

        for (var i = 0; i < count; i++) {
            var p = state.peaks ? peakBar(state.peaks, i, count) : pattern[i % pattern.length];
            var r = document.createElementNS(svgNS, 'rect');
            r.setAttribute('x', i * BAR_STEP);
            r.setAttribute('y', p.y);
            r.setAttribute('width', 3);
            r.setAttribute('height', p.h);
            r.setAttribute('rx', 1.5);
            r.setAttribute('fill', COLOR_IDLE);
            svg.appendChild(r);
        }
        state.bars = count;
    }

    // ارتفاع میله‌ی i‌ام از روی قله‌های واقعیِ صدا
    function peakBar(peaks, i, count) {
        var n = peaks.length;
        var lo = Math.floor(i * n / count);
        var hi = Math.max(lo + 1, Math.floor((i + 1) * n / count));
        var max = 0, sum = 0;
        for (var k = lo; k < hi && k < n; k++) {
            max = Math.max(max, peaks[k]);
            sum += peaks[k];
        }
        var v = (max + sum / (hi - lo)) / 2;
        var h = 3 + Math.round(v * 18);
        return { y: (21 - h) / 2, h: h };
    }

    function paint(state) {
        var ratio = state.position / state.duration;
        var played = Math.round(ratio * state.bars);
        state.$svg.find('rect').each(function (i) {
            this.setAttribute('fill', i < played ? COLOR_PLAYED : COLOR_IDLE);
        });
        var idle = state.position === 0;
        state.$time.text(formatTime(idle ? state.duration : state.duration - state.position));
        state.$wrap.attr('aria-valuenow', Math.round(ratio * 100));
    }

    // المان‌های SVG باید در namespace درست ساخته شوند؛ پارسر HTML با پوشش <svg> این کار را می‌کند
    function svgNodes(markup) {
        return $($.parseHTML('<svg xmlns="http://www.w3.org/2000/svg">' + markup + '</svg>')[0]).children();
    }

    function setIcon(state, playing) {
        state.$btn.attr({ 'aria-pressed': playing, 'aria-label': playing ? 'توقف ویس' : 'پخش ویس' });
        var $svg = state.$btn.find('svg');
        $svg.find('.play-glyph').remove();
        $svg.append(svgNodes(playing ? ICON_PAUSE : ICON_PLAY));
    }

    function pause(state) {
        clearInterval(state.timer);
        state.timer = null;
        if (state.audio) { state.audio.pause(); }
        setIcon(state, false);
    }

    function play(state) {
        // هم‌زمان فقط یک ویس پخش شود
        $.each(players, function (_, other) { if (other !== state && other.timer) { pause(other); } });
        if (state.position >= state.duration) { state.position = 0; }
        setIcon(state, true);

        if (state.audio) {
            // ویس واقعی: موقعیت از خودِ صدا خوانده می‌شود
            var started = state.audio.play();
            if (started && started.catch) {
                started.catch(function () { pause(state); showToast('پخش ویس ممکن نشد.'); });
            }
            state.timer = setInterval(function () {
                state.position = Math.min(state.audio.currentTime, state.duration);
                paint(state);
            }, 100);
            return;
        }

        state.timer = setInterval(function () {
            state.position += 0.1;
            if (state.position >= state.duration) {
                state.position = 0;
                pause(state);
            }
            paint(state);
        }, 100);
    }

    function stopAudioIn($card) {
        $card.find('.audio-player').each(function () {
            var st = $(this).data('state');
            if (st) {
                pause(st);
                releaseAudio(st);
                players = $.grep(players, function (p) { return p !== st; });
            }
        });
    }

    function stopAllAudio() {
        $.each(players, function (_, st) { pause(st); releaseAudio(st); });
        players = [];
    }

    // آزاد کردن منابع ویس‌هایی که کاربر ضبط کرده (Blob URL)
    function releaseAudio(st) {
        if (st.audio) {
            st.audio.pause();
            st.audio.removeAttribute('src');
            try { st.audio.load(); } catch (err) { /* بی‌اهمیت */ }
        }
        if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
    }

    $panel.on('click', '.play-btn', function () {
        var st = $(this).closest('.audio-player').data('state');
        if (!st) { return; }
        if (st.timer) { pause(st); } else { play(st); }
    });

    function seekTo(st, ratio) {
        st.position = Math.min(1, Math.max(0, ratio)) * st.duration;
        if (st.audio) {
            try { st.audio.currentTime = st.position; } catch (err) { /* هنوز بارگذاری نشده */ }
        }
        paint(st);
    }

    $panel.on('click', '.waveform-container', function (e) {
        var st = $(this).closest('.audio-player').data('state');
        if (!st) { return; }
        var rect = this.getBoundingClientRect();
        seekTo(st, (e.clientX - rect.left) / rect.width);
    });

    $panel.on('keydown', '.waveform-container', function (e) {
        var st = $(this).closest('.audio-player').data('state');
        if (!st) { return; }
        var step = 5;
        if (e.key === 'ArrowRight') { seekTo(st, (st.position + step) / st.duration); }
        else if (e.key === 'ArrowLeft') { seekTo(st, (st.position - step) / st.duration); }
        else if (e.key === 'Home') { seekTo(st, 0); }
        else if (e.key === 'End') { seekTo(st, 1); }
        else { return; }
        e.preventDefault();
    });

    // موج صوتی را با تغییر اندازه‌ی پنجره دوباره می‌سازیم
    var resizeTimer = null;
    $(window).on('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
            $.each(players, function (_, st) { buildWaveform(st); paint(st); });
        }, 150);
    });

    /* ---------- ضبط ویس ---------- */
    function $rec() { return $('#voiceRecorder'); }

    function setRecMode(mode) {
        var $r = $rec();
        $r.attr('data-mode', mode);
        $r.find('.rec-idle').prop('hidden', mode !== 'idle');
        $r.find('.rec-live').prop('hidden', mode !== 'recording');
        $r.find('.rec-done').prop('hidden', mode !== 'recorded');
        $r.find('[data-action="rec-start"]').prop('disabled', false);
        $r.find('[data-action="rec-stop"]').prop('disabled', false);
    }

    function pickMime() {
        var list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        for (var i = 0; i < list.length; i++) {
            if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(list[i])) { return list[i]; }
        }
        return '';
    }

    function extFor(type) {
        type = String(type || '');
        if (type.indexOf('mp4') > -1) { return 'm4a'; }
        if (type.indexOf('ogg') > -1) { return 'ogg'; }
        return 'webm';
    }

    function micErrorMessage(err) {
        var name = err && err.name;
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
            return 'دسترسی به میکروفون مجاز نیست. اجازه‌ی میکروفون را در تنظیمات مرورگر فعال کنید.';
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
            return 'میکروفونی پیدا نشد.';
        }
        if (name === 'NotReadableError' || name === 'TrackStartError') {
            return 'میکروفون در اختیار برنامه‌ی دیگری است.';
        }
        return 'شروع ضبط ممکن نشد.';
    }

    function stopStream(stream) {
        $.each(stream.getTracks(), function (_, t) { t.stop(); });
    }

    function startRecording() {
        if (rec) { return; }
        if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) || !window.MediaRecorder) {
            showToast('مرورگر شما از ضبط صدا پشتیبانی نمی‌کند (یا صفحه با HTTPS/localhost باز نشده است).');
            return;
        }
        releasePending(true);
        var token = ++recToken;
        $rec().find('[data-action="rec-start"]').prop('disabled', true);

        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
            .then(function (stream) {
                if (token !== recToken) { stopStream(stream); return; }   // فرم بسته یا بازنشانی شده
                beginRecording(stream);
            }, function (err) {
                if (token !== recToken) { return; }
                setRecMode('idle');
                showToast(micErrorMessage(err));
            });
    }

    function beginRecording(stream) {
        var mime = pickMime();
        var recorder;
        try {
            recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        } catch (err) {
            stopStream(stream);
            setRecMode('idle');
            showToast('ضبط صدا در این مرورگر ممکن نیست.');
            return;
        }

        var r = rec = {
            stream: stream, recorder: recorder, chunks: [], peaks: [], curMax: 0, level: 0,
            mime: recorder.mimeType || mime || '', startedAt: Date.now(), stoppedAt: 0,
            canceled: false, ctx: null, analyser: null, data: null, raf: 0, tick: 0
        };

        // اندازه‌گیری تراز صدا برای موج زنده و موج کارت
        try {
            var AC = window.AudioContext || window.webkitAudioContext;
            if (AC) {
                r.ctx = new AC();
                r.analyser = r.ctx.createAnalyser();
                r.analyser.fftSize = 1024;
                r.data = new Uint8Array(r.analyser.fftSize);
                r.ctx.createMediaStreamSource(stream).connect(r.analyser);
                if (r.ctx.state === 'suspended') { r.ctx.resume(); }
            }
        } catch (err) { r.analyser = null; }

        recorder.ondataavailable = function (e) {
            if (e.data && e.data.size) { r.chunks.push(e.data); }
        };
        recorder.onerror = function () {
            showToast('در ضبط صدا خطایی رخ داد.');
            r.canceled = true;
            stopRecording();
        };
        recorder.onstop = function () { finishRecording(r); };

        recorder.start(250);
        setRecMode('recording');
        $rec().find('.rec-timer').text(formatTime(0));
        var canvas = $rec().find('.rec-canvas')[0];
        var dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        canvas.height = Math.floor(32 * dpr);

        r.tick = setInterval(function () {
            var sec = (Date.now() - r.startedAt) / 1000;
            r.peaks.push(r.curMax);
            r.curMax = 0;
            $rec().find('.rec-timer').text(formatTime(sec));
            if (sec >= MAX_REC_SEC) {
                showToast('به حداکثر مدت ضبط (۵ دقیقه) رسیدید.');
                stopRecording();
            }
        }, 100);

        (function loop() {
            if (rec !== r) { return; }
            var level;
            if (r.analyser) {
                r.analyser.getByteTimeDomainData(r.data);
                var peak = 0;
                for (var i = 0; i < r.data.length; i++) {
                    peak = Math.max(peak, Math.abs(r.data[i] - 128) / 128);
                }
                level = Math.min(1, peak * 1.6);
            } else {
                level = 0.3 + Math.random() * 0.3;
            }
            r.level = level;
            r.curMax = Math.max(r.curMax, level);
            drawLive(canvas, r);
            r.raf = requestAnimationFrame(loop);
        })();
    }

    function drawLive(canvas, r) {
        var ctx = canvas.getContext('2d');
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.width, h = canvas.height;
        var step = 5 * dpr, bw = 3 * dpr;
        var count = Math.floor(w / step);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#132D84';
        var bars = r.peaks.slice(-(count - 1)).concat([r.level]);
        for (var k = 0; k < bars.length; k++) {
            var bh = Math.max(3 * dpr, bars[k] * h);
            var x = w - (bars.length - k) * step;
            ctx.fillRect(x, (h - bh) / 2, bw, bh);
        }
    }

    function cleanupRec(r) {
        clearInterval(r.tick);
        cancelAnimationFrame(r.raf);
        stopStream(r.stream);
        if (r.ctx && r.ctx.close) { r.ctx.close().catch(function () {}); }
    }

    function stopRecording() {
        var r = rec;
        if (!r || r.stopping) { return; }
        r.stopping = true;
        r.stoppedAt = Date.now();
        clearInterval(r.tick);
        cancelAnimationFrame(r.raf);
        $rec().find('[data-action="rec-stop"]').prop('disabled', true);
        if (r.recorder.state !== 'inactive') { r.recorder.stop(); } else { finishRecording(r); }
    }

    function finishRecording(r) {
        if (r.finished) { return; }
        r.finished = true;
        cleanupRec(r);
        if (rec === r) { rec = null; }
        if (r.canceled) { return; }

        var duration = ((r.stoppedAt || Date.now()) - r.startedAt) / 1000;
        if (!r.chunks.length || duration < MIN_REC_SEC) {
            setRecMode('idle');
            showToast('ضبط خیلی کوتاه بود؛ دوباره تلاش کنید.');
            return;
        }

        var type = r.mime || r.chunks[0].type || 'audio/webm';
        var blob = new Blob(r.chunks, { type: type });

        // نرمال‌سازی قله‌ها تا موج کارت خوانا باشد
        var top = 0.08;
        $.each(r.peaks, function (_, v) { top = Math.max(top, v); });
        var peaks = $.map(r.peaks.length ? r.peaks : [0.3], function (v) { return Math.min(1, v / top); });

        var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        pendingVoice = {
            blob: blob, url: URL.createObjectURL(blob), duration: duration, peaks: peaks,
            filename: 'voice-' + stamp + '.' + extFor(type)
        };

        var audio = $rec().find('.rec-audio')[0];
        if (!audio.prepared) { prepareAudio(audio, null); audio.prepared = true; }   // فقط یک بار
        audio.src = pendingVoice.url;
        setRecMode('recorded');
    }

    // revoke=false وقتی است که مالکیت URL به کارت ثبت‌شده منتقل می‌شود
    function releasePending(revoke) {
        var audio = $rec().find('.rec-audio')[0];
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            try { audio.load(); } catch (err) { /* بی‌اهمیت */ }
        }
        if (pendingVoice && revoke) { URL.revokeObjectURL(pendingVoice.url); }
        pendingVoice = null;
    }

    // لغو ضبط جاری + حذف ویس ضبط‌شده‌ی ثبت‌نشده (بسته شدن فرم / بازنشانی)
    function resetVoice() {
        recToken++;
        if (rec) { rec.canceled = true; stopRecording(); }
        releasePending(true);
        setRecMode('idle');
    }

    function submitVoiceFeedback($newForm, text) {
        var v = pendingVoice;
        var $card = $('<div>').html(voiceTemplateHTML).children().first();
        $card.addClass('is-new');
        $card.find('.user-name').text('شما');
        $card.find('.user-avatar').attr('alt', 'شما');
        $card.find('.status-toolbar3').addClass('is-unconfirmed')
            .children('span').last().text(TXT_UNCONFIRMED);
        $card.find('.timer-toolbar3 > span').last().text('هم‌اکنون');
        $card.find('.audio-time').attr('data-duration', v.duration).text(formatTime(v.duration));
        if (text) { $('<div class="toolbar2-txt">').text(text).appendTo($card); }

        // پلیر باید بعد از قرار گرفتن در صفحه ساخته شود تا عرض موج درست اندازه‌گیری شود
        $newForm.after($card);
        var $player = $card.find('.audio-player');
        initPlayer($player, {
            peaks: v.peaks,
            audio: new Audio(v.url),
            url: v.url,
            filename: v.filename
        });
        setIcon($player.data('state'), false);
        $card.hide().slideDown(220);

        releasePending(false);            // URL حالا مال کارت است
        $newForm.find('textarea').val('');
        toggleNewForm(false);
        updateEmpty();
        addLog('بازخورد صوتی ثبت شد (' + formatTime(v.duration) + ').');
        showToast('ویس ثبت شد.');
    }

    $panel.on('click', '[data-action="rec-start"]', startRecording);
    $panel.on('click', '[data-action="rec-stop"]', stopRecording);
    $panel.on('click', '[data-action="rec-discard"]', function () {
        releasePending(true);
        setRecMode('idle');
    });

    /* ---------- شروع ---------- */
    $('.audio-player').each(function () {
        initPlayer($(this));
        setIcon($(this).data('state'), false);
    });
    updateEmpty();
});
