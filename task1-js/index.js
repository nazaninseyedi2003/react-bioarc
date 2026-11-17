/* =====================================================================
   بایوآرک - رفتار سایدبار (jQuery)
   شامل: ثبت بازخورد جدید، کد تشخیص، برچسب آموزشی، مقالات مرتبط (لایک / دیس‌لایک / افزودن / حذف)،
   نظرات، آزمون‌های خودارزیابی و باز/بسته شدن بخش‌های پرونده.
   همهٔ تغییرات در localStorage ذخیره می‌شود و بعد از رفرش باقی می‌ماند.
   برای بازنشانی: در کنسول مرورگر  BioarcSidebar.reset()
   ===================================================================== */
$(function () {
  'use strict';

  /* ------------------------------------------------------------------
     ذخیره‌سازی (با حافظهٔ موقت در صورت نبودن localStorage)
  ------------------------------------------------------------------ */
  var PREFIX = 'bioarc_sidebar_v2_';
  var memory = {};

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(PREFIX + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
    }
  }

  function write(key, value) {
    memory[key] = value;
    try { window.localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* حالت خصوصی مرورگر */ }
  }

  // پاک‌سازی کلیدهای نسخهٔ قدیمی (که نگاشت لایک/کامنت در آن اشتباه بود)
  try {
    $.each(['likeState', 'deletedComments', 'newComments'], function (_, k) {
      window.localStorage.removeItem('task2b_sidebar_' + k);
    });
  } catch (e) { /* ignore */ }

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isStr(v) { return typeof v === 'string'; }

  var S = read('state', {});
  if (!isObj(S)) S = {};

  /* دادهٔ ذخیره‌شده ممکن است خراب شده یا دستی تغییر کرده باشد (مثلاً آیتم null).
     شکل آن یک‌بار همین‌جا اصلاح می‌شود تا یک مقدار نامعتبر کل اسکریپت را از کار نیندازد. */
  (function cleanState() {
    if (!isObj(S.votes)) S.votes = {};
    if (!isObj(S.cmt)) S.cmt = {};
    if (!isStr(S.draft)) delete S.draft;

    // بخش‌های removed / added (برچسب‌ها، مقالات، نظرات، آزمون‌ها)
    $.each(S, function (_, o) {
      if (!isObj(o) || !('added' in o || 'removed' in o)) return;
      o.removed = $.grep(Array.isArray(o.removed) ? o.removed : [], isStr);
      o.added = $.grep(Array.isArray(o.added) ? o.added : [], function (a) { return isObj(a) && isStr(a.id); });
    });

    // بازخوردها
    S.feedbacks = $.grep(Array.isArray(S.feedbacks) ? S.feedbacks : [], function (f) { return isObj(f) && isStr(f.id); });
    $.each(S.feedbacks, function (_, f) {
      if (!isStr(f.author)) f.author = '';
      if (!isStr(f.text)) f.text = '';
      if (f.html != null && !isStr(f.html)) delete f.html;
      f.ts = +f.ts || 0;
      f.approved = !!f.approved;
      f.mentions = $.grep(Array.isArray(f.mentions) ? f.mentions : [], isStr);
      f.files = $.grep(Array.isArray(f.files) ? f.files : [], function (x) { return isObj(x) && isStr(x.name); });
      $.each(f.files, function (_, x) { x.size = +x.size || 0; });
      if (f.replyTo && !(isObj(f.replyTo) && isStr(f.replyTo.id) && isStr(f.replyTo.author) && isStr(f.replyTo.text))) delete f.replyTo;
    });

    // لاگ فعالیت‌ها
    S.logs = $.grep(Array.isArray(S.logs) ? S.logs : [], isObj);
    $.each(S.logs, function (_, l) {
      l.text = isStr(l.text) ? l.text : '';
      l.user = isStr(l.user) ? l.user : '';
      l.ts = +l.ts || 0;
    });
  })();

  function sec(name) {
    var o = isObj(S[name]) ? S[name] : (S[name] = {});
    if (!Array.isArray(o.removed)) o.removed = [];
    if (!Array.isArray(o.added)) o.added = [];
    return o;
  }
  function save() { write('state', S); }

  /* ------------------------------------------------------------------
     ابزارها
  ------------------------------------------------------------------ */
  var FA = '۰۱۲۳۴۵۶۷۸۹';
  var AR = '٠١٢٣٤٥٦٧٨٩';

  function toFa(n) {
    return String(n).replace(/[0-9]/g, function (d) { return FA.charAt(d); });
  }

  function toInt(str) {
    var en = String(str || '')
      .replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); })
      .replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); })
      .replace(/[^\d]/g, '');
    var n = parseInt(en, 10);
    return isNaN(n) ? 0 : n;
  }

  function uid() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function has(list, id) { return $.inArray(id, list) > -1; }
  function without(list, id) { return $.grep(list, function (x) { return x !== id; }); }

  function shamsi(ts) {
    try {
      return new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-arabext', { year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(ts)).replace(/[\u200e\u200f]/g, '');
    } catch (e) {
      return new Date(ts).toLocaleDateString('fa-IR');
    }
  }

  function timeAgo(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'همین الان';
    var m = Math.floor(s / 60);
    if (m < 60) return toFa(m) + ' دقیقه پیش';
    var h = Math.floor(m / 60);
    if (h < 24) return toFa(h) + ' ساعت پیش';
    var d = Math.floor(h / 24);
    if (d < 7) return toFa(d) + ' روز پیش';
    var w = Math.floor(d / 7);
    if (w < 5) return toFa(w) + ' هفته پیش';
    return shamsi(ts);
  }

  var $sidebar = $('.sidebar');
  var SEED_COMMENTS = $('#commentList .part4-sidebar3-item').length;

  /* قالب‌های SVG از خود صفحه برداشته می‌شوند (قبل از اعمال هر حذفی) */
  function outer($el) { return $el.length ? $el[0].outerHTML : ''; }
  var TPL = {
    del: outer($sidebar.find('.article-item .del-sidebar3 svg').first()),
    like: '',
    dislike: '',
    comment: outer($sidebar.find('.stat-comment svg').first()),
    personArticle: outer($sidebar.find('.article-item .ai-sidebar3.person').first()),
    personExam: outer($sidebar.find('.exam-item[data-kind="person"] .icon-sidebar3 svg').first()),
    sparkle: outer($sidebar.find('.tagsidebar1-sick svg').first())
  };

  /* آیکن‌های لایک / دیس‌لایک: حالت توخالی (غیرفعال) و توپر (فعال) */
  var THUMB = {
    outline: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    solid: '<path d="M7 11l4-9a3 3 0 0 1 3 3v4h5.66a2 2 0 0 1 2 2.3l-1.38 9a2 2 0 0 1-2 1.7H7z" fill="currentColor" stroke="none"/><path d="M2 13a2 2 0 0 1 2-2h1.5v11H4a2 2 0 0 1-2-2z" fill="currentColor" stroke="none"/>'
  };
  function thumbSvg(role, active) {
    var g = THUMB[active ? 'solid' : 'outline'];
    if (role === 'dislike') g = '<g transform="rotate(180 12 12)">' + g + '</g>';
    return '<svg class="thumb-ic" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + g + '</svg>';
  }

  /* ------------------------------------------------------------------
     اعلان (Toast) با امکان «بازگردانی»
  ------------------------------------------------------------------ */
  var $toastWrap = $('<div class="sb-toast-wrap" aria-live="polite"></div>').appendTo('body');

  function toast(message, actionLabel, onAction) {
    var $t = $('<div class="sb-toast" role="status"></div>');
    $('<span class="sb-toast-msg"></span>').text(message).appendTo($t);
    var timer = null;
    function hide() {
      clearTimeout(timer);
      $t.removeClass('show');
      setTimeout(function () { $t.remove(); }, 220);
    }
    if (actionLabel) {
      $('<button type="button" class="sb-toast-action"></button>').text(actionLabel)
        .on('click', function () { hide(); if (onAction) onAction(); }).appendTo($t);
    }
    $toastWrap.append($t);
    // حداکثر ۳ اعلان همزمان
    $toastWrap.children().slice(0, -3).remove();
    setTimeout(function () { $t.addClass('show'); }, 10);
    timer = setTimeout(hide, 6000);
  }

  /* حذف با انیمیشن + امکان بازگردانی */
  function removeWithUndo($el, o) {
    var $parent = $el.parent();
    var $prev = $el.prev();
    var done = function () {
      $el.detach().css('display', '');
      if (o.after) o.after();
    };
    if (o.fade) $el.stop(true, true).fadeOut(150, done);
    else $el.stop(true, true).slideUp(180, done);
    o.onRemove();
    toast(o.message, 'بازگردانی', function () {
      $el.stop(true, true);
      o.onUndo();
      if ($prev.length && $.contains(document.documentElement, $prev[0])) $prev.after($el);
      else $parent.prepend($el);
      $el.css('display', '').addClass('sb-pop-in');
      setTimeout(function () { $el.removeClass('sb-pop-in'); }, 400);
      if (o.after) o.after();
    });
  }

  function markRemoved(name, id) {
    var st = sec(name);
    if (!has(st.removed, id)) st.removed.push(id);
    save();
  }
  function unmarkRemoved(name, id) {
    var st = sec(name);
    st.removed = without(st.removed, id);
    save();
  }
  // آیتم‌های افزوده‌شده‌ای که حذف شده‌اند از حافظه پاک می‌شوند
  function prune(name) {
    var st = sec(name);
    $.each(st.added, function (_, a) { if (has(st.removed, a.id)) delete S.votes[a.id]; });
    st.added = $.grep(st.added, function (a) { return !has(st.removed, a.id); });
  }

  /* ------------------------------------------------------------------
     فرم درون‌خطی (افزودن برچسب / مقاله / آزمون)
  ------------------------------------------------------------------ */
  function buildInlineForm(o) {
    var $f = $('<div class="sb-inline-form"></div>').hide();
    var $row = $('<div class="sb-inline-row"></div>');
    var $in = $('<input type="text" class="sb-inline-input" autocomplete="off" />')
      .attr({ placeholder: o.placeholder, 'aria-label': o.placeholder, maxlength: o.maxlength || 80 });
    var $btn = $('<button type="button" class="sb-inline-btn"></button>').text(o.submitLabel || 'افزودن');
    var $err = $('<div class="sb-inline-error" role="alert"></div>');
    $row.append($in, $btn);
    $f.append($row, $err);

    var api = {
      $el: $f,
      isOpen: function () { return $f.is(':visible'); },
      open: function () {
        $f.stop(true, true).slideDown(150, function () { $in.trigger('focus'); });
        if (o.onToggle) o.onToggle(true);
      },
      close: function () {
        $f.stop(true, true).slideUp(150);
        $err.text('');
        if (o.onToggle) o.onToggle(false);
      },
      toggle: function () { if (api.isOpen()) api.close(); else api.open(); }
    };

    function submit() {
      var msg = o.onSubmit(norm($in.val()));
      if (msg) { $err.text(msg); $in.trigger('focus'); return; }
      $in.val('');
      $err.text('');
      if (o.keepOpen) $in.trigger('focus'); else api.close();
    }

    $btn.on('click', submit);
    $in.on('keydown', function (e) {
      if (e.key === 'Enter' && !(e.originalEvent && e.originalEvent.isComposing)) { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { api.close(); }
    }).on('input', function () { $err.text(''); });
    return api;
  }

  function makeEmpty(text) { return $('<div class="sb-empty"></div>').text(text).hide(); }
  function refreshEmpty($items, $empty) { $empty.toggle($items.length === 0); }

  /* ------------------------------------------------------------------
     رفتارهای عمومی: لینک‌های # و دسترس‌پذیری کیبورد
  ------------------------------------------------------------------ */
  $sidebar.on('click', 'a[href="#"]', function (e) { e.preventDefault(); });

  $sidebar.on('keydown', '[role="button"]', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === this) {
      e.preventDefault();
      $(this).trigger('click');
    }
  });

  /* ------------------------------------------------------------------
     برچسب‌ها: «کد تشخیص» (t1) و «برچسب آموزشی» (t2)
  ------------------------------------------------------------------ */
  var SUGGESTIONS = ['فشار خون', 'دیابت نوع ۲', 'نارسایی قلبی', 'آسم', 'کم‌خونی', 'میگرن', 'اختلال تیروئید', 'آرتریت'];

  function initTagCard($card) {
    var key = $card.attr('data-tag-card');
    var isT1 = key === 't1';
    var st = sec(key);
    prune(key);

    var $container = $card.find('.sidebar1-container, .sidebar2-container').first();
    var $gear = $card.find('.sidebar1-btn').first();

    function tagText($t) { return norm($t.clone().children().remove().end().text()); }

    function addRemoveBtn($t) {
      $('<button type="button" class="tag-remove" aria-label="حذف برچسب" title="حذف">×</button>').appendTo($t);
    }

    function insertTag($t) {
      var $s = $container.children('.smart-tag');
      if ($s.length) $s.before($t); else $container.append($t);
    }

    function buildTag(tag) {
      var $t = isT1
        ? $('<span class="tagsidebar1 tagsidebar1-custom"></span>')
        : $('<span class="title-custom-sidebar2"></span>').addClass('tone-' + (tag.tone % 4));
      $t.attr('data-tag-id', tag.id).text(tag.text);
      if (tag.ai && TPL.sparkle) $t.append(TPL.sparkle);
      addRemoveBtn($t);
      return $t;
    }

    // برچسب‌های ثابت صفحه
    $container.children('[data-tag-id]').each(function () {
      var $t = $(this);
      if (has(st.removed, $t.attr('data-tag-id'))) { $t.remove(); return; }
      addRemoveBtn($t);
    });

    // برچسب‌های افزوده‌شده در بازدیدهای قبلی
    $.each(st.added, function (_, tag) { insertTag(buildTag(tag)); });
    save();

    function exists(text) {
      var found = false;
      $container.children('[data-tag-id]').each(function () {
        if (tagText($(this)).toLowerCase() === text.toLowerCase()) found = true;
      });
      return found;
    }

    function addTag(text, ai) {
      var tag = {
        id: uid(), text: text, ai: !!ai,
        tone: $container.children('[data-tag-id]').length
      };
      st.added.push(tag);
      save();
      var $t = buildTag(tag).addClass('sb-pop-in');
      insertTag($t);
      setTimeout(function () { $t.removeClass('sb-pop-in'); }, 400);
      return $t;
    }

    var form = buildInlineForm({
      placeholder: isT1 ? 'کد یا نام تشخیص جدید…' : 'برچسب آموزشی جدید…',
      maxlength: 24,
      keepOpen: true,
      onToggle: function (open) {
        $card.toggleClass('is-editing', open);
        $gear.attr('aria-pressed', open ? 'true' : 'false');
      },
      onSubmit: function (v) {
        if (!v) return 'نام برچسب را وارد کنید.';
        if (v.length > 24) return 'حداکثر ۲۴ کاراکتر مجاز است.';
        if (exists(v)) return 'این برچسب قبلاً اضافه شده است.';
        addTag(v, false);
      }
    });
    $container.after(form.$el);

    $gear.on('click', function () { form.toggle(); });

    // حذف برچسب
    $card.on('click', '.tag-remove', function (e) {
      e.stopPropagation();
      var $t = $(this).closest('[data-tag-id]');
      var id = $t.attr('data-tag-id');
      removeWithUndo($t, {
        fade: true,
        message: 'برچسب «' + tagText($t) + '» حذف شد',
        onRemove: function () { markRemoved(key, id); },
        onUndo: function () { unmarkRemoved(key, id); }
      });
    });

    // تگ هوشمند (فقط کد تشخیص): پیشنهاد یک برچسب جدید
    if (isT1) {
      $card.on('click', '.smart-tag', function () {
        var $s = $(this);
        if ($s.hasClass('is-loading')) return;
        var pick = null;
        $.each(SUGGESTIONS, function (_, name) { if (!exists(name)) { pick = name; return false; } });
        if (!pick) { toast('پیشنهاد جدیدی وجود ندارد.'); return; }
        $s.addClass('is-loading').attr('aria-busy', 'true');
        setTimeout(function () {
          $s.removeClass('is-loading').removeAttr('aria-busy');
          addTag(pick, true);
          toast('برچسب هوشمند «' + pick + '» اضافه شد');
        }, 700);
      });
    }
  }

  $('.tag-card').each(function () { initTagCard($(this)); });

  /* ------------------------------------------------------------------
     مقالات مرتبط
  ------------------------------------------------------------------ */
  (function () {
    var $card = $('#relatedArticles');
    var $list = $card.find('.article-list');
    if (!$list.length) return;

    var st = sec('articles');
    prune('articles');

    var $empty = makeEmpty('هنوز مقاله‌ای اضافه نشده است.');
    $list.after($empty);

    function items() { return $list.children('.article-item'); }
    function refresh() { refreshEmpty(items(), $empty); }

    function badge(role, label, count, svg) {
      var $b = $('<div class="stat-badge"></div>').addClass('stat-' + role)
        .attr({ 'data-role': role, role: 'button', tabindex: 0, 'aria-label': label });
      if (role !== 'comment') $b.attr('aria-pressed', 'false');
      $('<span></span>').text(toFa(count)).appendTo($b);
      $b.append(svg);
      return $b;
    }

    function buildArticle(a) {
      var $a = $('<div class="part1-sidebar3 article-item" data-kind="person" data-user="1"></div>')
        .attr('data-article-id', a.id);

      var $row = $('<div class="title-row"></div>');
      $row.append(TPL.personArticle);
      $('<span class="text-sidebar3"></span>').text(a.title).appendTo($row);

      var $tip = $('<div class="name-tip" role="tooltip"></div>').hide();
      $('<strong></strong>').text('شما').appendTo($tip);
      $('<span></span>').text('تاریخ ثبت: ' + shamsi(a.ts)).appendTo($tip);

      var $actions = $('<div class="action-row"></div>');
      $('<a href="#" class="view-article">مشاهده مقاله</a>').appendTo($actions);
      $('<span class="del-sidebar3" role="button" tabindex="0" aria-label="حذف مقاله" title="حذف"></span>')
        .html(TPL.del).appendTo($actions);

      var $stats = $('<div class="stats-row"></div>').append(
        badge('like', 'پسندیدن', 0, thumbSvg('like', false)),
        badge('dislike', 'نپسندیدن', 0, thumbSvg('dislike', false)),
        badge('comment', 'نظرات', 0, TPL.comment)
      );

      return $a.append($tip, $row, $actions, $stats);
    }

    // مقالات ثابت: حذف‌شده‌ها را بردار
    items().each(function () {
      if (has(st.removed, $(this).attr('data-article-id'))) $(this).remove();
    });

    // مقالات افزوده‌شده (جدیدترین بالا)
    for (var i = st.added.length - 1; i >= 0; i--) {
      $list.prepend(buildArticle(st.added[i]));
    }
    save();

    /* ---- لایک / دیس‌لایک ---- */
    function renderVotes($a) {
      var vote = S.votes[$a.attr('data-article-id')] || null;
      $.each(['like', 'dislike'], function (_, role) {
        var $b = $a.find('.stat-badge[data-role="' + role + '"]');
        var $num = $b.children('span').first();
        var base = $b.data('base');
        if (base === undefined) { base = toInt($num.text()); $b.data('base', base); }
        var active = vote === role;
        $num.text(toFa(base + (active ? 1 : 0)));
        $b.toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
        $b.children('svg').replaceWith(thumbSvg(role, active));
      });
    }

    items().each(function () { renderVotes($(this)); });

    /* ---- دکمهٔ نظرات: عدد = تعداد واقعی نظرها، رنگ = فعال/غیرفعال ---- */
    S.cmt = S.cmt || {};
    function commentDelta() { return $('#commentList .part4-sidebar3-item').length - SEED_COMMENTS; }
    function renderComments($a) {
      var $b = $a.find('.stat-badge[data-role="comment"]');
      if (!$b.length) return;
      var $num = $b.children('span').first();
      var base = $b.data('base');
      if (base === undefined) { base = toInt($num.text()); $b.data('base', base); }
      var active = !!S.cmt[$a.attr('data-article-id')];
      $num.text(toFa(Math.max(0, base + commentDelta() + (active ? 1 : 0))));
      $b.toggleClass('active', active).attr('aria-pressed', active ? 'true' : 'false');
    }
    function renderAllComments() { items().each(function () { renderComments($(this)); }); }
    renderAllComments();
    $(document).on('comments:changed', renderAllComments);

    $card.on('click', '.stat-badge[data-role="like"], .stat-badge[data-role="dislike"]', function () {
      var $b = $(this);
      var $a = $b.closest('.article-item');
      var id = $a.attr('data-article-id');
      var role = $b.attr('data-role');
      if (S.votes[id] === role) delete S.votes[id]; else S.votes[id] = role;
      save();
      renderVotes($a);
      $b.addClass('sb-bump');
      setTimeout(function () { $b.removeClass('sb-bump'); }, 220);
    });

    // کلیک روی نظرات: تغییر رنگ + رفتن به باکس نظر
    $card.on('click', '.stat-badge[data-role="comment"]', function () {
      var $b = $(this);
      var $a = $b.closest('.article-item');
      var id = $a.attr('data-article-id');
      if (S.cmt[id]) delete S.cmt[id]; else S.cmt[id] = true;
      save();
      renderComments($a);
      $b.addClass('sb-bump');
      setTimeout(function () { $b.removeClass('sb-bump'); }, 220);
      var $input = $('.part4-sidebar3-input');
      if (!$input.length) return;
      try { $input[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* ignore */ }
      $input.trigger('focus');
    });

    /* ---- نمایش اطلاعات ثبت‌کننده (tooltip) ---- */
    function tipFor($icon) { return $icon.closest('.article-item').find('.name-tip').first(); }
    $card.find('.article-item .ai-sidebar3.person').attr('tabindex', 0);
    $card.find('.name-tip').hide();
    $card.on('mouseenter focusin', '.ai-sidebar3.person', function () { tipFor($(this)).stop(true, true).fadeIn(120); });
    $card.on('mouseleave focusout', '.ai-sidebar3.person', function () { tipFor($(this)).stop(true, true).fadeOut(100); });

    /* ---- حذف مقاله ---- */
    $card.on('click', '.article-item .del-sidebar3', function () {
      var $a = $(this).closest('.article-item');
      var id = $a.attr('data-article-id');
      removeWithUndo($a, {
        message: 'مقاله حذف شد',
        onRemove: function () { markRemoved('articles', id); },
        onUndo: function () { unmarkRemoved('articles', id); },
        after: refresh
      });
    });

    /* ---- مقالهٔ جدید ---- */
    var $addBtn = $card.find('.add-article-btn');
    var form = buildInlineForm({
      placeholder: 'عنوان مقالهٔ جدید…',
      maxlength: 120,
      submitLabel: 'افزودن',
      onToggle: function (open) { $addBtn.attr('aria-expanded', open ? 'true' : 'false'); },
      onSubmit: function (v) {
        if (!v) return 'عنوان مقاله را وارد کنید.';
        if (v.length < 3) return 'عنوان باید حداقل ۳ کاراکتر باشد.';
        var a = { id: uid(), title: v, ts: Date.now() };
        st.added.unshift(a);
        save();
        var $a = buildArticle(a).addClass('sb-pop-in');
        $list.prepend($a);
        renderVotes($a);
        renderComments($a);
        setTimeout(function () { $a.removeClass('sb-pop-in'); }, 400);
        refresh();
        toast('مقاله اضافه شد');
      }
    });
    $card.find('.sidebar3-header').first().after(form.$el);
    $addBtn.on('click', function () { form.toggle(); });

    refresh();
  })();

  /* ------------------------------------------------------------------
     نظرات
  ------------------------------------------------------------------ */
  (function () {
    var $list = $('#commentList');
    var $input = $('.part4-sidebar3-input');
    var $send = $('.part4-sidebar3-send-btn');
    if (!$list.length) return;

    var st = sec('comments');
    prune('comments');

    var $empty = makeEmpty('هنوز نظری ثبت نشده است.');
    $list.append($empty);

    var avatarClasses = ['part4-sidebar3-avatar-green', 'part4-sidebar3-avatar-peach'];

    function items() { return $list.children('.part4-sidebar3-item'); }
    function refresh() { refreshEmpty(items(), $empty); $(document).trigger('comments:changed'); }

    function buildComment(c) {
      var $item = $('<div class="part4-sidebar3-item"></div>').attr('data-comment-id', c.id);
      var $header = $('<div class="part4-sidebar3-header"></div>');
      var $user = $('<div class="part4-sidebar3-user"></div>');
      $user.append(
        $('<div class="part4-sidebar3-avatar"></div>').addClass(c.avatar).text(c.username.charAt(0)),
        $('<span class="part4-sidebar3-username"></span>').text(c.username)
      );
      var $del = $('<button class="part4-sidebar3-delete" type="button" aria-label="حذف نظر" title="حذف"></button>').html(TPL.del);
      $header.append($user, $del);
      var $text = $('<p class="part4-sidebar3-text"></p>').text(c.text);
      var $time = $('<div class="part4-sidebar3-time"></div>').attr('data-ts', c.ts).text(timeAgo(c.ts));
      return $item.append($header, $text, $time);
    }

    items().each(function () {
      if (has(st.removed, $(this).attr('data-comment-id'))) $(this).remove();
    });
    for (var i = st.added.length - 1; i >= 0; i--) {
      $list.prepend(buildComment(st.added[i]));
    }
    save();
    refresh();

    function addComment() {
      var text = norm($input.val());
      if (!text) {
        $input.addClass('is-invalid').trigger('focus');
        setTimeout(function () { $input.removeClass('is-invalid'); }, 600);
        return;
      }
      var c = {
        id: uid(), username: 'شما', text: text, ts: Date.now(),
        avatar: avatarClasses[st.added.length % avatarClasses.length]
      };
      st.added.unshift(c);
      save();
      var $item = buildComment(c).addClass('sb-pop-in');
      $list.prepend($item);
      setTimeout(function () { $item.removeClass('sb-pop-in'); }, 400);
      $list.scrollTop(0);
      $input.val('').trigger('focus');
      refresh();
    }

    $send.on('click', function (e) { e.preventDefault(); addComment(); });
    $input.on('keydown', function (e) {
      if (e.key === 'Enter' && !(e.originalEvent && e.originalEvent.isComposing)) { e.preventDefault(); addComment(); }
    });

    $list.on('click', '.part4-sidebar3-delete', function () {
      var $item = $(this).closest('.part4-sidebar3-item');
      var id = $item.attr('data-comment-id');
      removeWithUndo($item, {
        message: 'نظر حذف شد',
        onRemove: function () { markRemoved('comments', id); },
        onUndo: function () { unmarkRemoved('comments', id); },
        after: refresh
      });
    });

    // به‌روزرسانی زمان نسبی نظرهای تازه
    setInterval(function () {
      $list.find('.part4-sidebar3-time[data-ts]').each(function () {
        $(this).text(timeAgo(parseInt($(this).attr('data-ts'), 10)));
      });
    }, 60000);
  })();

  /* ------------------------------------------------------------------
     آزمون خودارزیابی
  ------------------------------------------------------------------ */
  (function () {
    var $card = $('.sidebar4');
    var $list = $card.find('.exam-list');
    if (!$list.length) return;

    var st = sec('exams');
    prune('exams');

    var $empty = makeEmpty('هنوز آزمونی ساخته نشده است.');
    $list.after($empty);

    function items() { return $list.children('.exam-item'); }
    function refresh() { refreshEmpty(items(), $empty); }

    function buildExam(e) {
      var $e = $('<div class="sidebar4-main exam-item" data-kind="person"></div>').attr('data-exam-id', e.id);
      var $title = $('<span class="icon-sidebar3"></span>').html(TPL.personExam)
        .append(document.createTextNode(' ' + e.title));
      var $row = $('<div></div>');
      $('<a href="#" class="view-article">مشاهده آزمون</a>').appendTo($row);
      $('<span class="del-sidebar3 exam-del" role="button" tabindex="0" aria-label="حذف آزمون" title="حذف"></span>')
        .html(TPL.del).appendTo($row);
      return $e.append($title, $row);
    }

    items().each(function () {
      if (has(st.removed, $(this).attr('data-exam-id'))) $(this).remove();
    });
    $.each(st.added, function (_, e) { $list.append(buildExam(e)); });
    save();
    refresh();

    $card.on('click', '.exam-del', function () {
      var $e = $(this).closest('.exam-item');
      var id = $e.attr('data-exam-id');
      removeWithUndo($e, {
        message: 'آزمون حذف شد',
        onRemove: function () { markRemoved('exams', id); },
        onUndo: function () { unmarkRemoved('exams', id); },
        after: refresh
      });
    });

    var $addBtn = $card.find('.add-exam-btn');
    var form = buildInlineForm({
      placeholder: 'عنوان آزمون جدید…',
      maxlength: 60,
      onToggle: function (open) { $addBtn.attr('aria-expanded', open ? 'true' : 'false'); },
      onSubmit: function (v) {
        if (!v) return 'عنوان آزمون را وارد کنید.';
        if (v.length < 3) return 'عنوان باید حداقل ۳ کاراکتر باشد.';
        var e = { id: uid(), title: v };
        st.added.push(e);
        save();
        var $e = buildExam(e).addClass('sb-pop-in');
        $list.append($e);
        setTimeout(function () { $e.removeClass('sb-pop-in'); }, 400);
        refresh();
        toast('آزمون اضافه شد');
      }
    });
    $card.find('.sidebar3-header').first().after(form.$el);
    $addBtn.on('click', function () { form.toggle(); });
  })();

  /* ------------------------------------------------------------------
     باز/بسته شدن بخش‌های «مشخصات پرونده»، «خلاصه پرونده» و «فعالیت‌ها»
  ------------------------------------------------------------------ */
  $('.file-details1').each(function () {
    var $header = $(this);
    var $target = $header.hasClass('flesh')
      ? $header.siblings('.tabs-wrapper, .tab-content')
      : $header.next();

    if (!$target.length) return;

    $header.attr('role', 'button').attr('tabindex', '0');

    function toggleSection() {
      $target.stop(true, true).slideToggle(220);
      $header.toggleClass('is-collapsed');
    }

    $header.on('click', toggleSection);
    $header.on('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection(); }
    });
  });

  /* ------------------------------------------------------------------
     ثبت بازخورد جدید
     - متن با دکمهٔ «ثبت» یا Ctrl+Enter به‌صورت کارت جدید اضافه می‌شود.
     - دکمه‌های ویرایشگر: زیرخط، نقل‌قول، ایتالیک، بولد (Ctrl+U / I / B) و پیوست فایل.
     - منشن: لیست مثل طرح اصلی باز است؛ با کلیک روی «منشن:» بسته/باز می‌شود.
     - ویرایش، حذف (با بازگردانی)، تغییر وضعیت و ذخیرهٔ خودکار پیش‌نویس.
     - همه‌چیز در localStorage ذخیره می‌شود و بعد از رفرش باقی می‌ماند.
  ------------------------------------------------------------------ */
  var FB_AUTHOR = { name: 'ستایش قبادی', img: './image/dr.png' };
  var FB_MAX = 2000;

  /* ویرایشگر متن غنی: textarea با یک contenteditable جایگزین می‌شود تا بولد/ایتالیک/زیرخط/نقل‌قول
     همان لحظه در خود ویرایشگر دیده شوند (نه به‌صورت علامت‌های خام مثل ** یا ++) */
  var $fbTextarea = $('.tb4-input').first();
  var $fbInput  = $('<div class="tb4-input tb4-rich" contenteditable="true" role="textbox" aria-multiline="true" dir="rtl"></div>')
    .attr({ 'data-placeholder': $fbTextarea.attr('placeholder') || '', 'aria-label': 'متن بازخورد' });
  $fbTextarea.replaceWith($fbInput);
  var $fbEditor = $('.tb4-editor');
  var $fbForm   = $('.tb4-footer form');
  var $fbTagBox = $('.tb4-tag-box');
  var $fbPop    = $('.tb4-pop');
  var $fbItems  = $('.tb4-pop-item');
  var $fbAnchor = $('.feedback-toolbar3').first();   // کارت‌های جدید قبل از این بخش درج می‌شوند
  var $fbAttach = $('.mention2-toolbar4');
  var $fbTools  = $('.tb4-tools .tb4-btn');

  var FB_TPL = {
    card: $('.feedback-toolbar2').first().clone(),
    tag: $fbTagBox.find('.tb4-tag').first().clone(),
    clip: outer($fbTools.eq(4).find('svg').first())
  };

  // افراد قابل منشن (از چک‌باکس‌های موجود در صفحه)
  var FB_PEOPLE = $fbItems.map(function (i) {
    var $it = $(this);
    var $av = $it.find('.tb4-avatar, .tb4-avatar-img').first();
    return {
      id: i,
      name: norm($it.find('.tb4-name').text()),
      $chk: $it.find('.tb4-chk'),
      avatar: outer($av),
      svg: outer($it.find('svg').first()),
      isImg: $av.is('img'),
      imgSrc: $av.attr('src') || '',
      def: $it.find('.tb4-chk').prop('checked')
    };
  }).get();

  function fbPerson(name) {
    return $.grep(FB_PEOPLE, function (p) { return p.name === name; })[0];
  }

  /* --- کارت نمونهٔ داخل HTML به یک آیتم داده‌محور تبدیل می‌شود تا
         پاسخ / ویرایش / حذف / وضعیت آن هم مثل بقیهٔ کارت‌ها کار کند --- */
  var $fbSeedCard = $('.feedback-toolbar2').first();
  var FB_SEED_ID = 'seed-1';
  function fbSeedItem() {
    var lines = [], mentions = [];
    $fbSeedCard.find('.line-divider3').nextAll().each(function () {
      var $n = $(this);
      if ($n.is('img')) lines.push('![' + ($n.attr('alt') || '') + '](' + $n.attr('src') + ')');
      else if (norm($n.text())) lines.push(norm($n.text()));
    });
    $fbSeedCard.find('.avatar-group').children().each(function () {
      var $m = $(this), hit;
      if ($m.is('img')) {
        hit = $.grep(FB_PEOPLE, function (p) { return p.isImg && p.imgSrc === $m.attr('src'); })[0];
      } else {
        var fill = $m.find('circle').first().attr('fill');
        hit = $.grep(FB_PEOPLE, function (p) { return !p.isImg && $(p.svg).find('circle').first().attr('fill') === fill && p.name === 'علیرضا گودرزی'; })[0];
      }
      if (hit && !has(mentions, hit.name)) mentions.push(hit.name);
    });
    return {
      id: FB_SEED_ID, author: norm($fbSeedCard.find('.toolbar2-name').first().text()),
      text: lines.join('\n'), ts: 0, mentions: mentions, files: [],
      approved: $fbSeedCard.find('.status-badge').hasClass('badge-green'), seed: true
    };
  }
  var FB_SEED = fbSeedItem();

  /* --- قالب‌بندی امن متن: **بولد**  _ایتالیک_  ++زیرخط++  و خطوطی که با «> » شروع شوند --- */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\+\+(.+?)\+\+/g, '<u>$1</u>')
      .replace(/(^|[\s(،؛:])_(.+?)_(?=$|[\s).،؛:!؟?])/g, '$1<em>$2</em>');
  }
  function fbHtml(text) {
    var out = [];
    $.each(String(text).split(/\n/), function (_, line) {
      if (!String(line).trim()) return;
      var im = /^\s*!\[([^\]]*)\]\((\.\/image\/[\w.\-]+)\)\s*$/.exec(line);   // فقط تصاویر داخل پوشهٔ image
      if (im) { out.push('<img class="toolbar2-image" alt="' + esc(im[1]) + '" src="' + im[2] + '">'); return; }
      var q = /^\s*>\s?(.*)$/.exec(line);
      out.push(q
        ? '<blockquote class="fb-quote">' + inline(q[1]) + '</blockquote>'
        : '<div class="toolbar2-txt">' + inline(line) + '</div>');
    });
    return out.join('');
  }

  /* --- پاک‌سازی امن HTML: فقط strong / em / u / blockquote / div / br و تصویر داخل ./image/ --- */
  var RICH_TAGS = { B: 'strong', STRONG: 'strong', I: 'em', EM: 'em', U: 'u', BLOCKQUOTE: 'blockquote', DIV: 'div', P: 'div', BR: 'br', IMG: 'img' };
  function cleanInto(src, dst) {
    $.each(src.childNodes, function (_, n) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.nodeValue)); return; }
      if (n.nodeType !== 1) return;
      if (/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|NOSCRIPT)$/.test(n.nodeName)) return;
      var t = RICH_TAGS[n.nodeName];
      if (!t) { cleanInto(n, dst); return; }               // تگ ناشناخته: فقط محتوایش نگه داشته می‌شود
      if (t === 'img') {
        var u = n.getAttribute('src') || '';
        if (/^\.\/image\/[\w.\-]+$/.test(u)) {
          var im = document.createElement('img');
          im.setAttribute('src', u); im.setAttribute('alt', n.getAttribute('alt') || '');
          dst.appendChild(im);
        }
        return;
      }
      var el = document.createElement(t);
      if (t !== 'br') cleanInto(n, el);
      dst.appendChild(el);
    });
  }
  function cleanHtmlEl(html) {
    // DOMParser سند خنثی می‌سازد؛ برخلاف innerHTML هیچ onerror/اسکریپتی اجرا نمی‌شود
    var body = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html').body;
    var out = document.createElement('div');
    cleanInto(body, out);
    return out;
  }
  function cleanHtml(html) { return cleanHtmlEl(html).innerHTML; }

  /* متن ساده (برای لاگ، اکسل و خلاصه‌ها): نقل‌قول‌ها با «> » و تصویرها با ![alt](src) */
  function richText(html) {
    var lines = [], buf = '';
    function flush(q) {
      var t = buf.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
      if (t) lines.push((q ? '> ' : '') + t);
      buf = '';
    }
    function walk(node, q) {
      $.each(node.childNodes, function (_, n) {
        if (n.nodeType === 3) buf += n.nodeValue;
        else if (n.nodeName === 'BR') flush(q);
        else if (n.nodeName === 'IMG') { flush(q); lines.push('![' + (n.getAttribute('alt') || '') + '](' + n.getAttribute('src') + ')'); }
        else if (n.nodeName === 'DIV' || n.nodeName === 'BLOCKQUOTE') {
          var qq = q || n.nodeName === 'BLOCKQUOTE';
          flush(q); walk(n, qq); flush(qq);
        } else walk(n, q);
      });
    }
    walk(cleanHtmlEl(html), false);
    flush(false);
    return lines.join('\n');
  }

  /* HTML نهایی داخل کارت: بلوک‌ها با کلاس‌های طرح اصلی (toolbar2-txt / fb-quote) */
  function richRender(html) {
    var src = cleanHtmlEl(html), out = document.createElement('div'), buf = null;
    function hasContent(el) { return !!(el.textContent.replace(/\u00a0/g, ' ').trim() || el.querySelector('img')); }
    $.each(src.childNodes, function (_, n) {
      var blk = n.nodeType === 1 && (n.nodeName === 'DIV' || n.nodeName === 'BLOCKQUOTE');
      if (!blk) {
        if (n.nodeName === 'BR') { buf = null; return; }
        if (n.nodeName === 'IMG') { buf = null; out.appendChild(n.cloneNode(true)); return; }
        if (n.nodeType === 3 && !n.nodeValue.replace(/\u00a0/g, ' ').trim() && !buf) return;
        if (!buf) { buf = document.createElement('div'); buf.className = 'toolbar2-txt'; out.appendChild(buf); }
        buf.appendChild(n.cloneNode(true));
        return;
      }
      buf = null;
      if (!hasContent(n)) return;
      var isQ = n.nodeName === 'BLOCKQUOTE';
      var last = out.lastChild;
      var el = (isQ && last && last.nodeName === 'BLOCKQUOTE') ? last : document.createElement(isQ ? 'blockquote' : 'div');
      if (el === last) el.appendChild(document.createElement('br'));       // خط بعدیِ همان نقل‌قول
      else { el.className = isQ ? 'fb-quote' : 'toolbar2-txt'; out.appendChild(el); }
      $.each(n.childNodes, function (_, c) { el.appendChild(c.cloneNode(true)); });
    });
    $(out).find('img').addClass('toolbar2-image');
    return out.innerHTML;
  }
  // برای آیتم‌های قدیمی که فقط text دارند از فرمت **...** استفاده می‌شود
  function fbItemHtml(item) { return item.html ? richRender(item.html) : fbHtml(item.text); }

  /* --- دستورهای ویرایشگر (روی هر contenteditable) --- */
  try { document.execCommand('defaultParagraphSeparator', false, 'div'); } catch (e) { /* ignore */ }

  function within(el, n) { return !!n && (el === n || $.contains(el, n)); }
  function rcFocus($ed) {
    var el = $ed[0], sel = window.getSelection();
    if (sel.rangeCount && within(el, sel.anchorNode)) { if (document.activeElement !== el) el.focus(); return; }
    el.focus();
    if (!sel.rangeCount || !within(el, sel.anchorNode)) {
      var r = document.createRange();
      r.selectNodeContents(el); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
  }
  function rcInQuote($ed) {
    var sel = window.getSelection();
    if (!sel.rangeCount || !within($ed[0], sel.anchorNode)) return false;
    var n = sel.anchorNode;
    return $(n.nodeType === 3 ? n.parentNode : n).closest('blockquote', $ed[0]).length > 0;
  }
  function rcApply($ed, name) {
    rcFocus($ed);
    try { document.execCommand('styleWithCSS', false, false); } catch (e) { /* ignore */ }
    if (name === 'quote') {
      if (rcInQuote($ed)) { if (!document.execCommand('outdent')) document.execCommand('formatBlock', false, 'div'); }
      else document.execCommand('formatBlock', false, 'blockquote');
    } else {
      document.execCommand(name, false, null);
    }
    $ed.trigger('input');
    rcState();
  }
  // Enter روی خط خالیِ داخل نقل‌قول، از نقل‌قول خارج می‌شود
  function rcEnter(e, $ed) {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!rcInQuote($ed)) return;
    var n = window.getSelection().anchorNode;
    var $q = $(n.nodeType === 3 ? n.parentNode : n).closest('blockquote', $ed[0]);
    if ($q.length && !$q.text().replace(/\u00a0/g, ' ').trim() && !$q.find('img').length) {
      e.preventDefault();
      rcApply($ed, 'quote');
    }
  }
  // درج متن ساده با رعایت سقف کاراکتر (پیست همیشه «بدون قالب» است)
  function rcPaste(e, $ed) {
    e.preventDefault();
    var cd = (e.originalEvent || e).clipboardData || window.clipboardData;
    var t = cd ? String(cd.getData('text') || '').replace(/\r/g, '') : '';
    var room = FB_MAX - $ed.text().length + String(window.getSelection()).length;
    t = t.slice(0, Math.max(0, room));
    if (!t) return;
    document.execCommand('insertHTML', false, $.map(t.split('\n'), function (l) { return esc(l); }).join('<br>'));
  }
  function rcDrop(e) { var dt = (e.originalEvent || e).dataTransfer; if (dt && dt.files && dt.files.length) e.preventDefault(); }

  var FB_CMDS = ['underline', 'quote', 'italic', 'bold'];          // ترتیب دکمه‌ها در نوار ابزار
  var FB_TITLES = ['زیرخط (Ctrl+U)', 'نقل‌قول', 'ایتالیک (Ctrl+I)', 'پررنگ (Ctrl+B)', 'پیوست فایل'];

  var $fbFile = $('<input type="file" multiple class="fb-file-input" tabindex="-1" aria-hidden="true">').appendTo($fbEditor.parent());

  // رنگ دکمه‌ها نشان می‌دهد قالب در محل مکان‌نما فعال است یا نه
  function rcState() {
    if (document.activeElement !== $fbInput[0]) { $fbTools.removeClass('is-active').removeAttr('aria-pressed'); return; }
    $fbTools.each(function (i) {
      if (i > 3) return;
      var on = FB_CMDS[i] === 'quote' ? rcInQuote($fbInput) : !!document.queryCommandState(FB_CMDS[i]);
      $(this).toggleClass('is-active', on).attr('aria-pressed', on ? 'true' : 'false');
    });
  }
  $(document).on('selectionchange', rcState);

  $fbTools.each(function (i) {
    $(this).attr({ title: FB_TITLES[i], 'aria-label': FB_TITLES[i] }).on('mousedown', function (e) {
      e.preventDefault();                          // فوکوس و انتخاب متن از بین نرود
    }).on('click', function () {
      if (i === 4) { $fbFile.trigger('click'); return; }
      rcApply($fbInput, FB_CMDS[i]);
    });
  });

  $fbInput.on('keydown', function (e) {
    rcEnter(e, $fbInput);
    if ((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'enter') { e.preventDefault(); fbSubmit(); }
    // Ctrl+B / I / U را خود مرورگر روی متن انتخاب‌شده اعمال می‌کند
  }).on('paste', function (e) { rcPaste(e, $fbInput); })
    .on('drop', rcDrop)
    .on('beforeinput', function (e) {
      var t = (e.originalEvent || e).inputType || '';
      if (/^insert/.test(t) && t !== 'insertFromPaste' && $fbInput.text().length >= FB_MAX && window.getSelection().isCollapsed) e.preventDefault();
    });

  /* --- پیوست فایل (فقط نام و حجم ذخیره می‌شود) --- */
  var fbFiles = [];
  var $fbFileList = $('<div class="fb-files" aria-live="polite"></div>').insertAfter($fbEditor);

  function fmtSize(n) {
    if (n < 1024) return toFa(n) + ' بایت';
    if (n < 1048576) return toFa(Math.round(n / 1024)) + ' کیلوبایت';
    return toFa((n / 1048576).toFixed(1).replace('.', '٫')) + ' مگابایت';
  }
  function fbRenderFiles() {
    $fbFileList.empty();
    $.each(fbFiles, function (i, f) {
      var $c = $('<span class="fb-file-chip"></span>');
      $('<span class="fb-file-name"></span>').text(f.name).appendTo($c);
      $('<span class="fb-file-size"></span>').text(fmtSize(f.size)).appendTo($c);
      $('<button type="button" class="fb-file-del" aria-label="حذف فایل">×</button>').attr('data-i', i).appendTo($c);
      $fbFileList.append($c);
    });
  }
  $fbFile.on('change', function () {
    $.each(this.files, function (_, f) {
      if (f.size > 10 * 1048576) { toast('فایل «' + f.name + '» بزرگ‌تر از ۱۰ مگابایت است'); return; }
      if (fbFiles.length >= 5) { toast('حداکثر ۵ فایل قابل پیوست است'); return false; }
      fbFiles.push({ name: f.name, size: f.size });
    });
    this.value = '';
    fbRenderFiles();
  });
  $fbAttach.attr({ role: 'button', tabindex: '0' }).css('cursor', 'pointer')
    .on('click', function () { $fbFile.trigger('click'); })
    .on('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $fbFile.trigger('click'); } });
  $fbFileList.on('click', '.fb-file-del', function () {
    fbFiles.splice(+$(this).attr('data-i'), 1);
    fbRenderFiles();
  });

  /* --- منشن: برچسب‌ها + لیست بازشونده --- */
  function fbRenderTags() {
    $fbTagBox.find('.tb4-tag').remove();
    $.each(FB_PEOPLE, function (_, p) {
      if (!p.$chk.prop('checked')) return;
      var $tag = FB_TPL.tag.clone();
      $tag.find('.tb4-avatar, .tb4-avatar-img').remove();
      $tag.prepend($(p.avatar).addClass('tb4-av-xs'));
      $tag.find('.tb4-name-mention').text(p.name);
      $tag.find('.tb4-tag-del').attr({ 'aria-label': 'حذف منشن', 'data-person': p.id });
      $fbTagBox.append($tag);
    });
    if (!$fbTagBox.find('.tb4-tag').length) {
      $fbTagBox.append('<span class="fb-no-tag">بدون منشن</span>');
    } else {
      $fbTagBox.find('.fb-no-tag').remove();
    }
    fbFitFooter();
  }

  // کادر سفید فرم را به اندازهٔ ردیف‌های اضافهٔ منشن بلندتر می‌کند
  function fbFitFooter() {
    var extra = Math.max(0, Math.round($fbTagBox.outerHeight() - 42));
    $('.toolbar4').each(function () { this.style.setProperty('--fb-extra', extra + 'px'); });

    // والدهای ارتفاع‌ثابت هم همان‌قدر بلند می‌شوند تا ردیف‌های اضافه بریده یا اسکرول‌دار نشوند
    var desktop = window.innerWidth > 1100;
    var $parents = $fbTagBox.parents('.tab-content, .activities-top, .file-details3, .file-details-main, .file-details');
    $parents.css('height', '');                       // اندازهٔ اصلی طرح
    if (!desktop || !$parents.length) return;
    var $tc = $fbTagBox.parents('.tab-content').first();
    var over = $fbTagBox.closest('.tb4-footer')[0].getBoundingClientRect().bottom
             - ($tc.length ? $tc[0].getBoundingClientRect().bottom : 0);
    if (over > 0) {                                   // فوتر از والد بیرون زده؛ همهٔ والدها همان‌قدر بلند شوند
      var grow = Math.ceil(over) + 8;
      $parents.each(function () {
        var $e = $(this), h = parseFloat($e.css('height'));
        if (h > 0) $e.css('height', (h + grow) + 'px');
      });
    }
  }
  var fbResizeT = null;
  $(window).on('resize', function () { clearTimeout(fbResizeT); fbResizeT = setTimeout(fbFitFooter, 100); });
  function popOpen(open) {
    $fbPop.toggleClass('is-closed', !open);
    $fbTagBox.find('.tb4-tag-lbl').attr('aria-expanded', open ? 'true' : 'false');
  }

  $fbItems.on('change', '.tb4-chk', fbRenderTags);
  $fbTagBox.on('click', '.tb4-tag-del', function (e) {
    e.preventDefault();
    var p = FB_PEOPLE[+$(this).attr('data-person')];
    if (p) p.$chk.prop('checked', false);
    fbRenderTags();
  });
  $fbTagBox.find('.tb4-tag-lbl').attr({ role: 'button', tabindex: '0', title: 'انتخاب منشن' })
    .on('click', function (e) { e.stopPropagation(); popOpen($fbPop.hasClass('is-closed')); })
    .on('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); } });
  $fbInput.on('keyup', function (e) { if (e.key === '@' || (e.shiftKey && e.which === 50)) popOpen(true); });

  fbRenderTags();
  popOpen(false);   // لیست باز، دکمهٔ «پیوست فایل» را می‌پوشاند؛ با «منشن:» یا تایپ @ باز می‌شود
  $(document).on('mousedown', function (e) {
    if (!$(e.target).closest('.tb4-pop, .tb4-tag-lbl').length) popOpen(false);
  });

  /* --- پیش‌نویس خودکار + شمارندهٔ کاراکتر --- */
  var $fbCount = $('<div class="fb-counter" aria-live="off"></div>').appendTo($fbEditor);
  function fbCounter() {
    var n = $fbInput.text().length;
    $fbCount.text(toFa(n) + ' / ' + toFa(FB_MAX)).toggleClass('is-over', n > FB_MAX * 0.9);
  }
  function fbEditorEmpty() { return !$fbInput.text().replace(/\u00a0/g, ' ').trim() && !$fbInput.find('img').length; }
  $fbInput.on('input', function () {
    if (fbEditorEmpty() && this.firstChild) $fbInput.empty();      // تا placeholder دوباره نمایش داده شود
    if (fbEditorEmpty()) delete S.draft; else S.draft = cleanHtml(this.innerHTML);
    save();
    fbCounter();
  });
  if (S.draft) $fbInput.html(cleanHtml(S.draft)).trigger('input'); else fbCounter();

  /* --- ساخت کارت --- */
  function personEl(p) {
    var $a = $(p.isImg ? '<img class="avatar-circle-img" alt="">' : p.svg).attr('title', p.name);
    if (p.isImg) $a.attr('src', p.imgSrc);
    return $a;
  }

  function fbBuild(item) {
    var $c = FB_TPL.card.clone().addClass('fb-new').attr('data-fb-id', item.id);

    if (item.author === FB_AUTHOR.name) {
      $c.find('.toolbar2-user-name > svg').replaceWith(
        $('<img class="fb-author-img" alt="">').attr('src', FB_AUTHOR.img)
      );
    }
    $c.find('.toolbar2-name').text(item.author);
    $c.find('.icon-btn[title="پاسخ"]').addClass('fb-reply');
    $c.find('.icon-btn[title="ویرایش"]').addClass('fb-edit');
    $c.find('.icon-btn[title="حذف"]').addClass('fb-del');

    // وضعیت (قابل تغییر با کلیک)
    var $badge = $c.find('.status-badge').attr({ role: 'button', tabindex: '0', title: 'تغییر وضعیت' }).addClass('fb-status');
    fbPaintStatus($badge, !!item.approved);

    // منشن‌ها
    var $group = $c.find('.avatar-group').empty();
    var count = 0;
    $.each(item.mentions || [], function (_, name) {
      var p = fbPerson(name);
      if (p) { $group.append(personEl(p)); count++; }
    });
    if (!count) $c.find('.mention-section').hide();

    // متن (و ارجاع به بازخوردی که به آن پاسخ داده شده)
    $c.find('.line-divider3').nextAll().remove();
    if (item.replyTo) {
      var $ref = $('<div class="fb-quote fb-reply-ref" role="button" tabindex="0" title="رفتن به بازخورد اصلی"></div>').attr('data-ref', item.replyTo.id);
      $('<strong></strong>').text(item.replyTo.author + ': ').appendTo($ref);
      $('<span></span>').text(item.replyTo.text).appendTo($ref);
      $c.append($ref);
    }
    $('<div class="fb-body"></div>').html(fbItemHtml(item)).appendTo($c);

    // فایل‌ها
    if (item.files && item.files.length) {
      var $fl = $('<div class="fb-files fb-files-card"></div>');
      $.each(item.files, function (_, f) {
        var $ch = $('<span class="fb-file-chip"></span>');
        $(FB_TPL.clip).addClass('fb-clip').appendTo($ch);
        $('<span class="fb-file-name"></span>').text(f.name).appendTo($ch);
        $('<span class="fb-file-size"></span>').text(fmtSize(f.size)).appendTo($ch);
        $fl.append($ch);
      });
      $c.append($fl);
    }

    // زمان (کارت نمونه زمان ثبت ندارد)
    if (item.ts || item.edited) {
      var $t = $('<div class="fb-time"></div>');
      if (item.ts) $t.attr({ 'data-ts': item.ts, title: shamsi(item.ts) }).text(timeAgo(item.ts));
      if (item.edited) $('<span class="fb-edited"></span>').text((item.ts ? ' · ' : '') + 'ویرایش شده').appendTo($t);
      $c.append($t);
    }
    return $c;
  }

  function fbPaintStatus($b, ok) {
    $b.toggleClass('badge-red', !ok).toggleClass('badge-green', ok);
    $b.find('span').last().text(ok ? 'تایید شده' : 'تایید نشده');
  }

  /* ارتفاع والدهای ثابت‌ارتفاع بعد از هر تغییر در تعداد/اندازهٔ کارت‌ها دوباره تنظیم می‌شود */
  function fbRelayout() { fbFitFooter(); }

  function fbScrollTo($el) {
    if ($el.length && $el[0].scrollIntoView) $el[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* درج کارت در جای درست (idx = جایگاه در آرایه) */
  function fbInsert(item, idx, animate) {
    var $c = fbBuild(item);
    var $at = $('.fb-new').eq(idx);
    if ($at.length) $c.insertBefore($at);
    else if ($fbAnchor.length) $c.insertBefore($fbAnchor);
    else $c.appendTo('.tab-content');
    if (fbTab !== 0) { $c.hide(); return $c; }
    if (animate) {
      $c.hide().slideDown(220, function () { fbRelayout(); fbScrollTo($c); });
    } else {
      fbRelayout();
    }
    return $c;
  }
  function fbAppend(item, animate) { return fbInsert(item, $('.fb-new').length, animate); }

  function fbRedraw() {
    $('.fb-new').remove();
    $.each(S.feedbacks, function (_, f) { fbAppend(f, false); });
    fbRelayout();
  }
  function fbFind(id) {
    var r = -1;
    $.each(S.feedbacks, function (i, f) { if (f.id === id) r = i; });
    return r;
  }

  /* --- لاگ فعالیت‌ها (تب «لاگ‌ها») --- */
  S.logs = Array.isArray(S.logs) ? S.logs : [];
  function fbLog(text) {
    S.logs.unshift({ ts: Date.now(), text: text, user: FB_AUTHOR.name });
    if (S.logs.length > 100) S.logs.length = 100;
    save();
    if (fbTab === 1) fbRenderPane(1);
  }
  function brief(t) {
    var one = norm(String(t).replace(/!\[[^\]]*\]\([^)]*\)/g, '[تصویر]').replace(/^\s*>\s?/gm, '').replace(/(\*\*|\+\+)/g, ''));
    return one.length > 40 ? one.slice(0, 40) + '…' : one;
  }

  /* --- بلوک پاسخ (بالای فرم) --- */
  var $fbQuote = $('.tb4-quote');
  var fbReplyTo = null;
  function fbSetReply(item) {
    if (!item) { fbReplyTo = null; $fbQuote.hide(); fbRelayout(); return; }
    var first = '';
    $.each(String(item.text).split('\n'), function (_, l) {
      var t = norm(l.replace(/^\s*>\s?/, '').replace(/(\*\*|\+\+)/g, ''));
      if (t && !/^!\[/.test(t)) { first = t; return false; }
    });
    if (!first) first = '[تصویر]';
    if (first.length > 120) first = first.slice(0, 120) + '…';
    fbReplyTo = { id: item.id, author: item.author, text: first };
    $fbQuote.find('.toolbar2-name').text(item.author);
    $fbQuote.find('.tb4-q-user > .toolbar2-txt').text(first);
    $fbQuote.show();
    fbRelayout();
  }
  $fbQuote.find('.toolbar2-delete').attr({ role: 'button', tabindex: '0', 'aria-label': 'حذف پاسخ' })
    .on('click', function () { fbSetReply(null); })
    .on('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fbSetReply(null); } });

  /* --- مقداردهی اولیه: کارت نمونه به‌صورت آیتم ذخیره می‌شود (فقط یک‌بار) --- */
  S.feedbacks = Array.isArray(S.feedbacks) ? S.feedbacks : [];
  if (!S.seedDone) {
    S.feedbacks.unshift($.extend(true, {}, FB_SEED));
    S.seedDone = true;
    save();
  }
  $fbSeedCard.remove();

  /* --- تب‌ها: بازخوردها / لاگ‌ها / پیوست‌ها --- */
  var fbTab = 0;
  var $fbTabs = $('.tabs-wrapper .tab-btn');
  var $fbTabContent = $('.tab-content').first();
  var $fbPane = $('<div class="fb-pane" role="tabpanel"></div>').hide().appendTo($fbTabContent);

  function fbRenderPane(i) {
    $fbPane.empty();
    var $list = $('<ul class="fb-pane-list"></ul>');
    if (i === 1) {
      $.each(S.logs, function (_, l) {
        var $li = $('<li class="fb-pane-item"></li>');
        $('<span class="fb-pane-main"></span>').text(l.text).appendTo($li);
        $('<span class="fb-pane-meta"></span>').text(l.user + ' · ' + timeAgo(l.ts)).attr('title', shamsi(l.ts)).appendTo($li);
        $list.append($li);
      });
      if (!S.logs.length) $list.append('<li class="fb-pane-empty">هنوز فعالیتی ثبت نشده است</li>');
    } else {
      $.each(S.feedbacks, function (_, f) {
        $.each(f.files || [], function (_, file) {
          var $li = $('<li class="fb-pane-item"></li>');
          var $main = $('<span class="fb-pane-main"></span>').appendTo($li);
          $('<span class="fb-file-name"></span>').text(file.name).appendTo($main);
          $('<span class="fb-file-size"></span>').text(' ' + fmtSize(file.size)).appendTo($main);
          $('<span class="fb-pane-meta"></span>').text(f.author + (f.ts ? ' · ' + timeAgo(f.ts) : '')).appendTo($li);
          $list.append($li);
        });
      });
      if (!$list.children().length) $list.append('<li class="fb-pane-empty">هنوز فایلی پیوست نشده است</li>');
    }
    $fbPane.append($list);
  }

  function fbSwitchTab(i) {
    fbTab = i;
    $fbTabs.each(function (j) {
      $(this).toggleClass('active', j === i).attr({ 'aria-selected': j === i ? 'true' : 'false', tabindex: j === i ? '0' : '-1' });
    });
    var $parts = $fbTabContent.children('.feedback-toolbar, .fb-new, .feedback-toolbar3');
    if (i === 0) { $fbPane.hide(); $parts.show(); }
    else { $parts.hide(); fbRenderPane(i); $fbPane.show(); }
    fbRelayout();
  }
  $fbTabs.parent().attr('role', 'tablist');
  $fbTabs.attr('role', 'tab').each(function (j) { $(this).attr({ 'aria-selected': j === 0 ? 'true' : 'false', tabindex: j === 0 ? '0' : '-1' }); });
  $fbTabs.on('click', function () { fbSwitchTab($fbTabs.index(this)); })
    .on('keydown', function (e) {
      var i = $fbTabs.index(this), n = $fbTabs.length, to = -1;
      if (e.key === 'ArrowLeft') to = (i + 1) % n;            // صفحه راست‌به‌چپ است
      else if (e.key === 'ArrowRight') to = (i - 1 + n) % n;
      if (to > -1) { e.preventDefault(); fbSwitchTab(to); $fbTabs.eq(to).trigger('focus'); }
    });

  fbRedraw();
  fbSetReply(fbFind(FB_SEED_ID) > -1 ? S.feedbacks[fbFind(FB_SEED_ID)] : null);

  setInterval(function () {
    $('.fb-time[data-ts]').each(function () {
      var n = this.firstChild;
      if (n && n.nodeType === 3) n.nodeValue = timeAgo(+this.getAttribute('data-ts'));
    });
  }, 60000);

  /* --- وضعیت --- */
  $(document).on('click keydown', '.fb-new .fb-status', function (e) {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    var i = fbFind($(this).closest('.fb-new').attr('data-fb-id'));
    if (i < 0) return;
    S.feedbacks[i].approved = !S.feedbacks[i].approved;
    save();
    fbPaintStatus($(this), S.feedbacks[i].approved);
    fbLog('وضعیت بازخورد «' + brief(S.feedbacks[i].text) + '» به «' + (S.feedbacks[i].approved ? 'تایید شده' : 'تایید نشده') + '» تغییر کرد');
  });

  /* --- حذف با امکان بازگردانی --- */
  $(document).on('click', '.fb-new .fb-del', function () {
    var $c = $(this).closest('.fb-new');
    var idx = fbFind($c.attr('data-fb-id'));
    if (idx < 0) return;
    var item = S.feedbacks.splice(idx, 1)[0];
    save();
    if (fbReplyTo && fbReplyTo.id === item.id) fbSetReply(null);
    fbLog('بازخورد «' + brief(item.text) + '» حذف شد');
    $c.stop(true, true).slideUp(180, function () { $c.remove(); fbRelayout(); });
    toast('بازخورد حذف شد', 'بازگردانی', function () {
      var at = Math.min(idx, S.feedbacks.length);
      S.feedbacks.splice(at, 0, item);
      save();
      fbInsert(item, at, true);
      fbLog('بازخورد «' + brief(item.text) + '» بازگردانی شد');
    });
  });

  /* --- پاسخ: در بلوک پاسخِ بالای فرم قرار می‌گیرد و همراه بازخورد ثبت می‌شود --- */
  $(document).on('click', '.fb-new .fb-reply', function () {
    var i = fbFind($(this).closest('.fb-new').attr('data-fb-id'));
    if (i < 0) return;
    fbSetReply(S.feedbacks[i]);
    $fbInput.trigger('focus');
    fbScrollTo($fbEditor);
  });

  /* --- کلیک روی ارجاع داخل کارت: رفتن به بازخورد اصلی --- */
  $(document).on('click keydown', '.fb-new .fb-reply-ref', function (e) {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    var ref = $(this).attr('data-ref');
    var $t = $('.fb-new').filter(function () { return $(this).attr('data-fb-id') === ref; });
    if (!$t.length) { toast('بازخورد اصلی دیگر وجود ندارد'); return; }
    fbScrollTo($t);
    $t.addClass('fb-flash');
    setTimeout(function () { $t.removeClass('fb-flash'); }, 1400);
  });

  /* --- ویرایش درجا (با همان ویرایشگر غنی و نوار ابزار کوچک) --- */
  $(document).on('click', '.fb-new .fb-edit', function () {
    var $c = $(this).closest('.fb-new');
    if ($c.find('.fb-edit-box').length) { rcFocus($c.find('.fb-edit-input')); return; }
    var i = fbFind($c.attr('data-fb-id'));
    if (i < 0) return;
    var it = S.feedbacks[i];
    var $body = $c.find('.fb-body').hide();
    var $box = $('<div class="fb-edit-box"></div>');
    var $bar = $('<div class="fb-edit-tools" role="toolbar" aria-label="قالب‌بندی متن"></div>');
    $.each([['bold', 'B', 'پررنگ (Ctrl+B)'], ['italic', 'I', 'ایتالیک (Ctrl+I)'], ['underline', 'U', 'زیرخط (Ctrl+U)'], ['quote', '❝', 'نقل‌قول']], function (_, b) {
      $('<button type="button" class="fb-edit-tool"></button>').attr({ 'data-cmd': b[0], title: b[2], 'aria-label': b[2] }).text(b[1]).appendTo($bar);
    });
    var $ed = $('<div class="fb-edit-input" contenteditable="true" role="textbox" aria-multiline="true" dir="rtl"></div>')
      .html(cleanHtml(it.html || fbHtml(it.text)));
    var $row = $('<div class="fb-edit-actions"></div>');
    $('<button type="button" class="fb-btn fb-btn-primary fb-save">ذخیره</button>').appendTo($row);
    $('<button type="button" class="fb-btn fb-cancel">انصراف</button>').appendTo($row);
    $box.append($bar, $ed, $row).insertAfter($body);
    rcFocus($ed);
    fbRelayout();
  });
  $(document)
    .on('mousedown', '.fb-edit-tool', function (e) { e.preventDefault(); })
    .on('click', '.fb-edit-tool', function () {
      rcApply($(this).closest('.fb-edit-box').find('.fb-edit-input'), $(this).attr('data-cmd'));
    })
    .on('keydown', '.fb-edit-input', function (e) { rcEnter(e, $(this)); })
    .on('paste', '.fb-edit-input', function (e) { rcPaste(e, $(this)); })
    .on('drop', '.fb-edit-input', rcDrop);
  $(document).on('click', '.fb-new .fb-cancel', function () {
    var $c = $(this).closest('.fb-new');
    $c.find('.fb-edit-box').remove();
    $c.find('.fb-body').show();
    fbRelayout();
  });
  function fbSaveEdit($c) {
    var i = fbFind($c.attr('data-fb-id'));
    if (i < 0) return;
    var $ed = $c.find('.fb-edit-input');
    var html = cleanHtml($ed.html());
    var text = richText(html);
    if (!text) { toast('متن بازخورد نمی‌تواند خالی باشد'); return; }
    if ($ed.text().length > FB_MAX) { toast('متن بازخورد نباید بیشتر از ' + toFa(FB_MAX) + ' کاراکتر باشد'); return; }
    var it = S.feedbacks[i];
    if (html !== cleanHtml(it.html || fbHtml(it.text))) {
      it.html = html;
      it.text = text;
      it.edited = true;
      save();
      fbLog('بازخورد «' + brief(text) + '» ویرایش شد');
    }
    var $n = fbBuild(it);
    $c.replaceWith($n);
    fbRelayout();
  }
  $(document).on('click', '.fb-new .fb-save', function () { fbSaveEdit($(this).closest('.fb-new')); });
  $(document).on('keydown', '.fb-edit-input', function (e) {
    var $c = $(this).closest('.fb-new');
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); fbSaveEdit($c); }
    else if (e.key === 'Escape') { $c.find('.fb-cancel').trigger('click'); }
  });

  /* --- پاک‌کردن فرم (بعد از ثبت یا بازنشانی) --- */
  function fbResetForm(clearReply) {
    $fbInput.empty().trigger('input');
    delete S.draft; save();
    fbFiles = []; fbRenderFiles();
    $.each(FB_PEOPLE, function (_, p) { p.$chk.prop('checked', p.def); });
    fbRenderTags();
    popOpen(false);
    if (clearReply) fbSetReply(null);
  }

  /* --- نوار ابزار: بازخورد جدید / بازنشانی / چاپ / PDF / اکسل --- */
  $('.feedback-toolbar > button.add-feedback-btn').on('click', function () {
    if (fbTab !== 0) fbSwitchTab(0);
    $fbInput.trigger('focus');
    fbScrollTo($fbEditor);
  });

  function fbReportHtml() {
    var $root = $('<div></div>');
    $('<h1></h1>').text('گزارش بازخوردها').appendTo($root);
    $.each(S.feedbacks, function (_, f) {
      var $c = $('<section></section>').appendTo($root);
      var $h = $('<header></header>').appendTo($c);
      $('<b></b>').text(f.author).appendTo($h);
      $('<span></span>').text(' — ' + (f.approved ? 'تایید شده' : 'تایید نشده') + (f.ts ? ' — ' + shamsi(f.ts) : '')).appendTo($h);
      if (f.mentions && f.mentions.length) $('<div class="m"></div>').text('منشن: ' + f.mentions.join('، ')).appendTo($c);
      if (f.replyTo) $('<blockquote></blockquote>').text(f.replyTo.author + ': ' + f.replyTo.text).appendTo($c);
      $('<div></div>').html(fbItemHtml(f)).appendTo($c);
      if (f.files && f.files.length) $('<div class="m"></div>').text('پیوست: ' + $.map(f.files, function (x) { return x.name; }).join('، ')).appendTo($c);
    });
    return $root.html();
  }
  function fbPrint(kind) {
    if (!S.feedbacks.length) { toast('بازخوردی برای ' + kind + ' وجود ندارد'); return; }
    var css = '@font-face{font-family:Vazirmatn;src:url(./fonts/Vazirmatn-NL-Regular.woff2) format("woff2")}'
      + 'body{font-family:Vazirmatn,Tahoma,sans-serif;margin:24px;color:#222;line-height:1.9}'
      + 'h1{font-size:20px;color:#36459B}section{border:1px solid #B2C6E3;border-radius:10px;padding:12px 16px;margin:0 0 14px;page-break-inside:avoid}'
      + 'header{margin-bottom:6px}.m{color:#666;font-size:12px}blockquote{margin:6px 0;padding:4px 10px;border-right:3px solid #36459B;background:#EEF2FA}'
      + 'img{max-width:100%;height:auto;border-radius:8px}';
    var $f = $('<iframe class="fb-print-frame" aria-hidden="true" tabindex="-1"></iframe>').appendTo('body');
    var w = $f[0].contentWindow, d = w.document;
    d.open();
    d.write('<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>بازخوردها</title><style>' + css + '</style></head><body>' + fbReportHtml() + '</body></html>');
    d.close();
    setTimeout(function () {
      w.focus(); w.print();
      setTimeout(function () { $f.remove(); }, 1500);
    }, 300);
    fbLog('خروجی ' + kind + ' از بازخوردها گرفته شد');
  }
  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;                // جلوگیری از اجرای فرمول در اکسل
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function fbExcel() {
    if (!S.feedbacks.length) { toast('بازخوردی برای خروجی وجود ندارد'); return; }
    var rows = [['ردیف', 'نویسنده', 'وضعیت', 'منشن‌ها', 'تاریخ ثبت', 'متن', 'فایل‌های پیوست']];
    $.each(S.feedbacks, function (i, f) {
      rows.push([toFa(i + 1), f.author, f.approved ? 'تایید شده' : 'تایید نشده', (f.mentions || []).join('، '),
        f.ts ? shamsi(f.ts) : '', f.text, $.map(f.files || [], function (x) { return x.name; }).join('، ')]);
    });
    var csv = '\ufeff' + $.map(rows, function (r) { return $.map(r, csvCell).join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var $a = $('<a></a>').attr({ href: url, download: 'feedbacks.csv' }).appendTo('body');
    $a[0].click();
    $a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    fbLog('خروجی اکسل از بازخوردها گرفته شد');
    toast('فایل feedbacks.csv دانلود شد (با اکسل باز می‌شود)');
  }
  function fbResetAll() {
    var prev = S.feedbacks, prevLogs = S.logs;
    S.feedbacks = [$.extend(true, {}, FB_SEED)];
    save();
    fbRedraw();
    fbResetForm(false);
    fbSetReply(S.feedbacks[0]);
    fbLog('بازخوردها به حالت اولیه بازگشت');
    toast('بازخوردها به حالت اولیه برگشت', 'بازگردانی', function () {
      S.feedbacks = prev; S.logs = prevLogs;
      save();
      fbRedraw();
      fbSetReply(null);
      if (fbTab) fbRenderPane(fbTab);
    });
  }
  var $fbActs = $('.feedback-toolbar .action-buttons .icon-btn');
  $fbActs.eq(0).on('click', fbResetAll);
  $fbActs.eq(1).on('click', function () { fbPrint('چاپ'); });
  $fbActs.eq(2).on('click', function () { fbPrint('PDF'); if (S.feedbacks.length) toast('در پنجرهٔ چاپ، مقصد را «Save as PDF» انتخاب کنید'); });
  $fbActs.eq(3).on('click', fbExcel);

  /* --- ثبت --- */
  var fbBusy = false;
  function fbSubmit() {
    if (fbBusy) return;
    var html = cleanHtml($fbInput.html());
    var text = richText(html);
    if (!text) {
      $fbInput.trigger('focus');
      $fbEditor.addClass('fb-error');
      setTimeout(function () { $fbEditor.removeClass('fb-error'); }, 1200);
      toast('لطفاً ابتدا متن بازخورد را بنویسید');
      return;
    }
    if ($fbInput.text().length > FB_MAX) { toast('متن بازخورد نباید بیشتر از ' + toFa(FB_MAX) + ' کاراکتر باشد'); return; }
    fbBusy = true;
    setTimeout(function () { fbBusy = false; }, 400);       // جلوگیری از ثبت دوباره با دوبار کلیک

    var mentions = $.map(FB_PEOPLE, function (p) { return p.$chk.prop('checked') ? p.name : null; });
    var item = {
      id: uid(), author: FB_AUTHOR.name, text: text, html: html, ts: Date.now(),
      mentions: mentions, files: fbFiles.slice(), approved: false
    };
    if (fbReplyTo) item.replyTo = $.extend({}, fbReplyTo);
    S.feedbacks.push(item);
    save();
    fbAppend(item, true);
    fbLog('بازخورد جدید ثبت شد: «' + brief(text) + '»');

    fbResetForm(true);
    toast('بازخورد ثبت شد');
  }
  $fbForm.on('submit', function (e) { e.preventDefault(); fbSubmit(); });

  /* بازنشانی همهٔ تغییرات سایدبار (برای تست) */
  window.BioarcSidebar = {
    reset: function () {
      try { window.localStorage.removeItem(PREFIX + 'state'); } catch (e) { /* ignore */ }
      memory = {};
      window.location.reload();
    }
  };
});


/* =====================================================================
   پاپ‌اوور (Popover) برای همهٔ اِلمان‌هایی که ایونت هندلر دارند
   - با hover، فوکوس کیبورد و لمس نمایش داده می‌شود (با event delegation؛
     روی آیتم‌های ساخته‌شدهٔ بعدی هم کار می‌کند).
   - «مشاهده مقاله / آزمون» پاپ‌اوور کامل (عنوان، ثبت‌کننده، آمار) دارد.
   - برای اضافه‌کردن مورد جدید فقط یک خط به آرایهٔ POP_RULES اضافه کنید.
   ===================================================================== */
$(function () {
  'use strict';

  var $pop = $('<div class="bx-pop" role="tooltip" id="bxPop" dir="rtl"></div>').appendTo('body');
  var $cur = null, showT = null, hideT = null;

  function txt(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function stat($a, role) { return txt($a.find('.stat-badge[data-role="' + role + '"] > span').first().text()); }

  /* قوانین: [انتخاب‌گر، تابعی که {title, body, rows} برمی‌گرداند] */
  var POP_RULES = [
    ['.view-article', function ($el) {
      var $a = $el.closest('.article-item');
      if ($a.length) {
        var who = $a.attr('data-user') ? 'شما' : txt($a.find('.name-tip strong').first().text());
        var rows = [];
        if (who) rows.push(['ثبت‌کننده', who]);
        var date = txt($a.find('.name-tip span').first().text()).replace('تاریخ ثبت:', '');
        if (date) rows.push(['تاریخ ثبت', txt(date)]);
        rows.push(['پسندیدن', stat($a, 'like') || '۰'], ['نظرات', stat($a, 'comment') || '۰']);
        return { title: txt($a.find('.text-sidebar3').first().text()), body: 'برای مشاهدهٔ متن کامل مقاله کلیک کنید', rows: rows };
      }
      var $e = $el.closest('.exam-item');
      return { title: txt($e.find('.icon-sidebar3').first().text()), body: 'برای شروع و مشاهدهٔ آزمون کلیک کنید', rows: [['نوع', $e.attr('data-kind') === 'person' ? 'ساختهٔ شما' : 'آزمون آماده']] };
    }],
    ['.menu > .search', function () { return { title: 'جستجو', body: 'جستجو در پرونده، بازخوردها، مقالات و منو (کلید /)' }; }],
    ['.add-article-btn', function () { return { title: 'مقالهٔ جدید', body: 'یک مقالهٔ مرتبط به پرونده اضافه کنید' }; }],
    ['.add-exam-btn', function () { return { title: 'آزمون جدید', body: 'یک آزمون خودارزیابی بسازید' }; }],
    ['.sidebar1-btn', function () { return { title: 'ویرایش برچسب‌ها', body: 'افزودن یا حذف برچسب' }; }],
    ['.smart-tag', function () { return { title: 'برچسب هوشمند', body: 'یک برچسب پیشنهادی اضافه می‌شود' }; }],
    ['.tag-remove', function () { return { title: 'حذف برچسب', body: 'با امکان بازگردانی' }; }],
    ['.stat-badge[data-role="like"]', function () { return { title: 'پسندیدن', body: 'کلیک دوباره لایک را برمی‌دارد' }; }],
    ['.stat-badge[data-role="dislike"]', function () { return { title: 'نپسندیدن', body: 'کلیک دوباره برمی‌دارد' }; }],
    ['.stat-badge[data-role="comment"]', function () { return { title: 'نظرات', body: 'رفتن به بخش نظر' }; }],
    ['.exam-del', function () { return { title: 'حذف آزمون', body: 'با امکان بازگردانی' }; }],
    ['.article-item .del-sidebar3', function () { return { title: 'حذف مقاله', body: 'با امکان بازگردانی' }; }],
    ['.part4-sidebar3-delete', function () { return { title: 'حذف نظر', body: 'با امکان بازگردانی' }; }],
    ['.part4-sidebar3-send-btn', function () { return { title: 'ارسال نظر', body: 'یا کلید Enter' }; }],
    ['.mention2-toolbar4', function () { return { title: 'پیوست فایل', body: 'حداکثر ۵ فایل، هرکدام تا ۱۰ مگابایت' }; }],
    ['.tb4-tag-lbl', function () { return { title: 'منشن', body: 'انتخاب افراد (یا تایپ @)' }; }],
    ['.tb4-tag-del', function () { return { title: 'حذف منشن' }; }],
    ['.fb-status, .status-badge', function ($el) { return { title: 'وضعیت بازخورد', body: $el.hasClass('fb-status') ? 'برای تغییر وضعیت کلیک کنید' : '' }; }],
    ['.fb-file-del', function () { return { title: 'حذف فایل پیوست' }; }],
    ['.file-details1', function ($el) { return { title: 'باز/بسته کردن بخش', body: $el.hasClass('is-collapsed') ? 'نمایش محتوا' : 'پنهان کردن محتوا' }; }],
    // سایر دکمه‌ها (چاپ، PDF، اکسل، پاسخ، ویرایش، حذف بازخورد، ابزار ویرایشگر…) از title/aria-label خودشان
    ['.icon-btn, .tb4-btn, .fb-reply, .fb-edit, .fb-del', function () { return {}; }]
  ];
  var SELECTOR = $.map(POP_RULES, function (r) { return r[0]; }).join(',');

  /* title بومی مرورگر را به data منتقل کن تا دو tooltip هم‌زمان دیده نشود */
  function stealTitle(el) {
    var t = el.getAttribute('title');
    if (t) { el.setAttribute('data-pop-title', t); el.removeAttribute('title'); }
  }

  function describe($el) {
    var info = null;
    $.each(POP_RULES, function (_, r) {
      if ($el.is(r[0])) { info = r[1]($el) || {}; return false; }
    });
    info = info || {};
    if (!info.title) info.title = $el.attr('data-pop-title') || $el.attr('aria-label') || '';
    return info;
  }

  function render(info) {
    $pop.empty().removeClass('is-rich');
    if (info.title) $('<div class="bx-pop-title"></div>').text(info.title).appendTo($pop);
    if (info.body) $('<div class="bx-pop-body"></div>').text(info.body).appendTo($pop);
    if (info.rows && info.rows.length) {
      $pop.addClass('is-rich');
      var $l = $('<dl class="bx-pop-rows"></dl>').appendTo($pop);
      $.each(info.rows, function (_, r) {
        $('<dt></dt>').text(r[0]).appendTo($l);
        $('<dd></dd>').text(r[1]).appendTo($l);
      });
    }
    $('<span class="bx-pop-arrow"></span>').appendTo($pop);
    return !!(info.title || info.body);
  }

  function place($el) {
    var r = $el[0].getBoundingClientRect();
    var vw = document.documentElement.clientWidth, vh = window.innerHeight, gap = 10, m = 8;
    $pop.css({ left: 0, top: 0 }).addClass('is-measuring');
    var w = $pop.outerWidth(), h = $pop.outerHeight();
    var above = r.top - h - gap >= m;
    var top = above ? r.top - h - gap : Math.min(r.bottom + gap, vh - h - m);
    var left = Math.max(m, Math.min(r.left + r.width / 2 - w / 2, vw - w - m));
    var ax = Math.max(14, Math.min(r.left + r.width / 2 - left, w - 14));
    $pop.removeClass('is-measuring').toggleClass('is-below', !above)
      .css({ left: left, top: top }).get(0).style.setProperty('--bx-arrow-x', ax + 'px');
  }

  function show($el) {
    clearTimeout(hideT);
    stealTitle($el[0]);
    if (!render(describe($el))) return;
    $cur = $el;
    $el.attr('aria-describedby', 'bxPop');
    place($el);
    $pop.addClass('is-open');
  }
  function hide() {
    clearTimeout(showT);
    clearTimeout(hideT);
    softHide();
  }
  /* تایمرِ mouseleave نباید نمایشِ در انتظارِ المان بعدی را لغو کند
     (حرکت سریع ماوس بین دو دکمهٔ کنار هم، tooltip دومی را از بین می‌برد) */
  function softHide() {
    if ($cur) { $cur.removeAttr('aria-describedby'); $cur = null; }
    $pop.removeClass('is-open');
  }

  $(document)
    .on('mouseover', SELECTOR, function () { stealTitle(this); })
    .on('mouseenter', SELECTOR, function () {
      var $el = $(this); clearTimeout(showT);
      showT = setTimeout(function () { show($el); }, 220);
    })
    .on('mouseleave', SELECTOR, function () { clearTimeout(showT); hideT = setTimeout(softHide, 80); })
    .on('focusin', SELECTOR, function () { show($(this)); })
    .on('focusout', SELECTOR, hide)
    .on('keydown', function (e) { if (e.key === 'Escape') hide(); })
    .on('touchstart', SELECTOR, function () {
      var $el = $(this); show($el); clearTimeout(hideT); hideT = setTimeout(hide, 1800);
    })
    .on('click', SELECTOR, function () {
      // بعد از کلیک، پاپ‌اوور با وضعیت تازه (مثلاً «باز/بسته») دوباره ساخته می‌شود
      var $el = $(this);
      if ($cur && $cur[0] === this) setTimeout(function () { if ($cur && $cur[0] === $el[0]) show($el); }, 260);
    });
  $(window).on('scroll resize', function () { if ($cur) hide(); });
  $pop.on('mouseenter', function () { clearTimeout(hideT); }).on('mouseleave', hide);

  // پاک‌سازی title های موجود در صفحه از همان ابتدا
  $(SELECTOR).each(function () { stealTitle(this); });
});


/* =====================================================================
   دکمهٔ «تنظیمات» (.button-set)
   قبلاً با onclick="settingAction()" در HTML صدا زده می‌شد، اما این تابع هیچ‌جا تعریف نشده بود
   و هر کلیک خطای ReferenceError می‌داد. حالا با jQuery و event delegation مدیریت می‌شود و
   یک رویداد سفارشی (settings:open) می‌فرستد؛ هر کاری که قرار است انجام شود را روی همین رویداد وصل کنید:
       $(document).on('settings:open', function (e, button) { ... });
   ===================================================================== */
$(function () {
  'use strict';
  $(document).on('click', '.button-set', function () {
    $(document).trigger('settings:open', [this]);
  });
});


/* =====================================================================
   جستجوی سراسری (آیکون ذره‌بین در نوار منو)
   - با کلیک روی آیکون، کلید «/» یا Ctrl+K باز می‌شود؛ با Esc یا کلیک بیرون بسته می‌شود.
   - نتایج هر بار از روی DOM زندهٔ صفحه ساخته می‌شود؛ پس مقاله، نظر، آزمون، برچسب و بازخوردی که
     همین حالا اضافه یا حذف کرده‌اید هم دقیق جستجو می‌شود.
   - جستجو نسبت به «ی/ي»، «ک/ك»، اعداد فارسی/عربی/لاتین، نیم‌فاصله و اعراب حساس نیست.
   - انتخاب یک نتیجه (کلیک یا Enter): تب/بخشِ بستهٔ مربوط باز می‌شود، صفحه تا آن‌جا اسکرول می‌کند
     و آیتم چند لحظه هایلایت می‌شود.
   - برای اضافه‌کردن منبع جدید فقط یک مورد به آرایهٔ SOURCES اضافه کنید.
   ===================================================================== */
$(function () {
  'use strict';

  var $icon = $('.menu > .search').first();
  if (!$icon.length) return;

  var MAX_PER_GROUP = 8;

  /* ------------------------------ نرمال‌سازی متن ------------------------------ */
  var IGNORE = /[\u064B-\u065F\u0670\u0640\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/;   // اعراب، کشیده، نیم‌فاصله، علائم جهت
  var FOLD = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ة': 'ه', 'ۀ': 'ه', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و', 'ئ': 'ی' };
  var FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';

  function fold(c) {
    var p = FA.indexOf(c);
    if (p > -1) return String(p);
    p = AR.indexOf(c);
    if (p > -1) return String(p);
    return FOLD[c] || c.toLowerCase();
  }
  // متن نرمال‌شده + نگاشت هر نویسه به جایگاه آن در متن اصلی (برای هایلایت دقیق)
  function nm(str) {
    var s = '', map = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charAt(i);
      if (IGNORE.test(c)) continue;
      var f = fold(c);
      for (var k = 0; k < f.length; k++) { s += f.charAt(k); map.push(i); }
    }
    return { s: s, map: map };
  }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function toFa(n) { return String(n).replace(/[0-9]/g, function (d) { return FA.charAt(d); }); }
  function ownText($el) { return clean($el.clone().children().remove().end().text()); }

  /* ------------------------------ منابع جستجو ------------------------------ */
  function entry(group, el, title, sub) {
    title = clean(title); sub = clean(sub);
    return { group: group, el: el, title: title, sub: sub, t: nm(title), s: nm(sub) };
  }

  var SOURCES = [
    { group: 'منو', get: function () {
      var out = [];
      $('.menu > div').not($icon).each(function () {
        var t = clean($(this).text());
        if (t) out.push(entry('منو', this, t, ''));
      });
      return out;
    } },
    { group: 'پرونده', get: function () {
      var out = [];
      $('.cardio-info').each(function () {
        out.push(entry('پرونده', this, $(this).find('.cardio-type').text(), $(this).find('.cardio-row').text()));
      });
      $('.description-text').each(function () {
        out.push(entry('پرونده', this, $(this).find('.description-txt1').text(), $(this).find('.description-txt2').text()));
      });
      $('.summary-details2 .summary-text').each(function () {
        out.push(entry('پرونده', this, 'خلاصه پرونده', $(this).text()));
      });
      return out;
    } },
    { group: 'مشخصات پرونده', get: function () {
      var out = [];
      $('.grid-row .field-label').each(function () {
        var $v = $(this).nextAll('.field-value').first();
        if ($v.length) out.push(entry('مشخصات پرونده', $v[0], $(this).text().replace(/[:：]\s*$/, ''), $v.text()));
      });
      return out;
    } },
    { group: 'بازخوردها', get: function () {
      var out = [];
      $('.fb-new').each(function () {
        var $c = $(this);
        out.push(entry('بازخوردها', this, $c.find('.toolbar2-name').first().text(), $c.find('.fb-body').text()));
      });
      return out;
    } },
    { group: 'مقالات مرتبط', get: function () {
      var out = [];
      $('#relatedArticles .article-item').each(function () {
        out.push(entry('مقالات مرتبط', this, $(this).find('.text-sidebar3').first().text(), ''));
      });
      return out;
    } },
    { group: 'آزمون‌ها', get: function () {
      var out = [];
      $('.sidebar4 .exam-item').each(function () {
        out.push(entry('آزمون‌ها', this, ownText($(this).find('.icon-sidebar3').first()) || $(this).find('.icon-sidebar3').first().text(), ''));
      });
      return out;
    } },
    { group: 'نظرات', get: function () {
      var out = [];
      $('#commentList .part4-sidebar3-item').each(function () {
        out.push(entry('نظرات', this, $(this).find('.part4-sidebar3-username').first().text(), $(this).find('.part4-sidebar3-text').first().text()));
      });
      return out;
    } },
    { group: 'برچسب‌ها', get: function () {
      var out = [];
      $('.tag-card [data-tag-id]').each(function () {
        var t = ownText($(this));
        if (t) out.push(entry('برچسب‌ها', this, t, ''));
      });
      return out;
    } }
  ];

  function search(q) {
    var words = $.grep(nm(clean(q)).s.split(' '), function (w) { return w.length > 0; });
    if (!words.length) return null;
    var groups = [];
    $.each(SOURCES, function (_, src) {
      var list = [];
      $.each(src.get(), function (i, e) {
        var score = 0, ok = true;
        $.each(words, function (_, w) {
          var ti = e.t.s.indexOf(w), si = e.s.s.indexOf(w);
          if (ti === 0 || (ti > 0 && e.t.s.charAt(ti - 1) === ' ')) score += 3;   // ابتدای عنوان / ابتدای یک کلمه
          else if (ti > -1) score += 2;
          else if (si > -1) score += 1;
          else { ok = false; return false; }
        });
        if (ok) { e.score = score; e.order = i; list.push(e); }
      });
      list.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
      if (list.length) groups.push({ group: src.group, total: list.length, items: list.slice(0, MAX_PER_GROUP) });
    });
    return { words: words, groups: groups };
  }

  /* ------------------------------ هایلایت امن (بدون innerHTML) ------------------------------ */
  function ranges(n, words) {
    var r = [], m = [];
    $.each(words, function (_, w) {
      var from = 0, idx;
      while ((idx = n.s.indexOf(w, from)) > -1) {
        r.push([n.map[idx], n.map[idx + w.length - 1] + 1]);
        from = idx + w.length;
      }
    });
    r.sort(function (a, b) { return a[0] - b[0]; });
    $.each(r, function (_, x) {
      var last = m[m.length - 1];
      if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]); else m.push([x[0], x[1]]);
    });
    return m;
  }

  function fill($el, text, n, words, win) {
    var m = ranges(n, words), a = 0, b = text.length;
    if (win && text.length > win) {                       // متن بلند: فقط اطراف اولین تطابق نمایش داده می‌شود
      var first = m.length ? m[0][0] : 0;
      a = Math.max(0, first - Math.floor(win / 3));
      b = Math.min(text.length, a + win);
      a = Math.max(0, b - win);
    }
    var frag = document.createDocumentFragment(), pos = a;
    if (a > 0) frag.appendChild(document.createTextNode('…'));
    $.each(m, function (_, r) {
      var s = Math.max(r[0], a), e = Math.min(r[1], b);
      if (e <= s) return;
      if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
      var mk = document.createElement('mark');
      mk.textContent = text.slice(s, e);
      frag.appendChild(mk);
      pos = e;
    });
    if (pos < b) frag.appendChild(document.createTextNode(text.slice(pos, b)));
    if (b < text.length) frag.appendChild(document.createTextNode('…'));
    $el.empty()[0].appendChild(frag);
  }

  /* ------------------------------ ساخت پنل ------------------------------ */
  var $panel = $('<div class="gs-panel" id="gsPanel" role="dialog" aria-label="جستجو" dir="rtl"></div>').appendTo('body');
  var $field = $('<div class="gs-field"></div>').appendTo($panel);
  $('<span class="gs-field-ic" aria-hidden="true"></span>').html($icon.find('svg').first().prop('outerHTML') || '').appendTo($field);
  var $input = $('<input type="text" class="gs-input" id="gsInput" autocomplete="off" spellcheck="false" inputmode="search" enterkeyhint="search" />')
    .attr({ placeholder: 'جستجو در پرونده، بازخوردها، مقالات…', 'aria-label': 'عبارت جستجو', role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'gsList', 'aria-autocomplete': 'list' })
    .appendTo($field);
  var $clear = $('<button type="button" class="gs-clear" aria-label="پاک کردن عبارت" hidden>×</button>').appendTo($field);
  var $list = $('<ul class="gs-list" id="gsList" role="listbox" aria-label="نتایج جستجو"></ul>').appendTo($panel);
  var $foot = $('<div class="gs-foot"></div>').appendTo($panel);
  var $status = $('<span class="gs-status" role="status" aria-live="polite"></span>').appendTo($foot);
  $('<span class="gs-keys" aria-hidden="true">↑ ↓ حرکت · Enter انتخاب · Esc بستن</span>').appendTo($foot);

  $icon.attr({ role: 'button', tabindex: '0', 'aria-label': 'جستجو', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'gsPanel' });

  var isOpen = false, active = -1, words = [];

  function place() {
    var vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var w = Math.min(560, vw - 24);
    var menu = $icon.parent()[0].getBoundingClientRect();
    var top = Math.max(12, Math.min(menu.bottom + 6, vh - 220));
    $panel.css({ width: w, top: top, left: Math.max(12, (vw - w) / 2) });
    $list.css('max-height', Math.max(140, vh - top - 110));
  }

  function setActive(i, scroll) {
    var $o = $list.children('.gs-item');
    $o.removeClass('is-active').attr('aria-selected', 'false');
    if (i < 0 || i >= $o.length) { active = -1; $input.removeAttr('aria-activedescendant'); return; }
    active = i;
    var $a = $o.eq(i).addClass('is-active').attr('aria-selected', 'true');
    $input.attr('aria-activedescendant', $a.attr('id'));
    if (scroll && $a[0].scrollIntoView) $a[0].scrollIntoView({ block: 'nearest' });
  }

  function render() {
    var q = $input.val();
    $clear.prop('hidden', !q);
    $list.empty();
    active = -1;
    var res = search(q);
    if (!res) {
      $('<li class="gs-hint" role="presentation"></li>').text('عبارتی را وارد کنید تا در پرونده جستجو شود.').appendTo($list);
      $status.text('');
      setActive(-1);
      return;
    }
    words = res.words;
    if (!res.groups.length) {
      $('<li class="gs-hint" role="presentation"></li>').text('نتیجه‌ای برای «' + clean(q) + '» پیدا نشد.').appendTo($list);
      $status.text('نتیجه‌ای پیدا نشد');
      setActive(-1);
      return;
    }
    var k = 0, total = 0;
    $.each(res.groups, function (_, g) {
      total += g.total;
      var $h = $('<li class="gs-group" role="presentation"></li>').text(g.group).appendTo($list);
      $('<span class="gs-count"></span>').text(toFa(g.total)).appendTo($h);
      $.each(g.items, function (_, e) {
        var $li = $('<li class="gs-item" role="option" aria-selected="false"></li>').attr('id', 'gsOpt' + (k++)).data('entry', e);
        fill($('<span class="gs-title"></span>').appendTo($li), e.title, e.t, words, 0);
        if (e.sub) fill($('<span class="gs-sub"></span>').appendTo($li), e.sub, e.s, words, 80);
        $list.append($li);
      });
    });
    $status.text(toFa(total) + ' نتیجه');
    setActive(0, false);
    $list.scrollTop(0);
  }

  /* ------------------------------ باز / بسته ------------------------------ */
  function open() {
    if (!isOpen) {
      isOpen = true;
      place();
      $panel.addClass('is-open');
      $icon.addClass('is-open').attr('aria-expanded', 'true');
      $input.attr('aria-expanded', 'true');
      render();
    }
    $input.trigger('focus');
    $input[0].select();
  }
  function close(refocus) {
    if (!isOpen) return;
    isOpen = false;
    $panel.removeClass('is-open');
    $icon.removeClass('is-open').attr('aria-expanded', 'false');
    $input.attr('aria-expanded', 'false').removeAttr('aria-activedescendant');
    if (refocus) $icon.trigger('focus');
  }

  /* ------------------------------ رفتن به نتیجه ------------------------------ */
  function reveal($el) {
    var el = $el[0];
    if (!el || !el.getClientRects().length) return;          // هنوز پنهان است
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); } catch (e) { el.scrollIntoView(); }
    $el.removeClass('gs-flash');
    void el.offsetWidth;                                     // ری‌استارت انیمیشن
    $el.addClass('gs-flash');
    setTimeout(function () { $el.removeClass('gs-flash'); }, 2200);
  }

  function go(el) {
    if (!el || !$.contains(document.documentElement, el)) return;
    var $el = $(el), wait = 0;

    // بازخوردها فقط در تب «بازخوردها» دیده می‌شوند
    if ($el.closest('.fb-new').length) {
      var $tab0 = $('.tabs-wrapper .tab-btn').first();
      if ($tab0.length && !$tab0.hasClass('active')) { $tab0.trigger('click'); wait = 60; }
    }
    // بخش‌های جمع‌شده (مشخصات پرونده، خلاصه، فعالیت‌ها) باز می‌شوند
    $('.file-details1.is-collapsed').each(function () {
      var $h = $(this);
      var $t = $h.hasClass('flesh') ? $h.siblings('.tabs-wrapper, .tab-content') : $h.next();
      if ($t.is(el) || $t.has(el).length) { $h.trigger('click'); wait = Math.max(wait, 280); }
    });
    setTimeout(function () { reveal($el); }, wait);
  }

  function choose(i) {
    var $o = $list.children('.gs-item').eq(i);
    var e = $o.data('entry');
    if (!e) return;
    close(false);
    go(e.el);
  }

  /* ------------------------------ رویدادها ------------------------------ */
  $icon.on('click', function () { if (isOpen) close(false); else open(); })
    .on('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(this).trigger('click'); }
    });

  $input.on('input', render).on('keydown', function (e) {
    var n = $list.children('.gs-item').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((active + 1) % n, true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((active - 1 + n) % n, true); }
    else if (e.key === 'Home' && n && e.ctrlKey) { e.preventDefault(); setActive(0, true); }
    else if (e.key === 'End' && n && e.ctrlKey) { e.preventDefault(); setActive(n - 1, true); }
    else if (e.key === 'Enter' && !(e.originalEvent && e.originalEvent.isComposing)) {
      e.preventDefault();
      if (n) choose(active > -1 ? active : 0);
    }
  });

  $clear.on('mousedown', function (e) { e.preventDefault(); })
    .on('click', function () { $input.val('').trigger('focus'); render(); });

  $list.on('mousedown', '.gs-item', function (e) { e.preventDefault(); })      // فوکوس از input نرود
    .on('click', '.gs-item', function () { choose($list.children('.gs-item').index(this)); })
    .on('mousemove', '.gs-item', function () {
      var i = $list.children('.gs-item').index(this);
      if (i !== active) setActive(i, false);
    });

  // Esc، کلیک بیرون، میان‌بُرها
  $(document).on('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) { e.preventDefault(); close(true); return; }
    var el = e.target, tag = (el.nodeName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key || '').toLowerCase() === 'k') { e.preventDefault(); open(); return; }
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); open(); }
  });
  $(document).on('mousedown touchstart', function (e) {
    if (isOpen && !$(e.target).closest('#gsPanel, .menu > .search').length) close(false);
  });
  $(window).on('resize', function () { if (isOpen) place(); });
});
