/*
 * Small progressive enhancements for the owner reports page:
 * - sticky section tabs track the visible report section;
 * - daily chart bars get hover / tap / focus tooltips;
 * - the existing abandoned-cart phone copy button stays available.
 * Anchors, details/summary tables and all data work without JavaScript.
 */
(function () {
  "use strict";

  var LIVE_TEXT = "کپی شد";

  function activateTab(link, links) {
    links.forEach(function (item) {
      var active = item === link;
      item.classList.toggle("is-active", active);
      if (active) item.setAttribute("aria-current", "location");
      else item.removeAttribute("aria-current");
    });
  }

  function initSectionTabs() {
    var nav = document.querySelector("[data-report-tabs]");
    if (!nav) return;
    var links = Array.prototype.slice.call(nav.querySelectorAll("[data-report-tab]"));
    var sections = links.map(function (link) {
      return document.getElementById((link.getAttribute("href") || "").slice(1));
    }).filter(Boolean);
    if (!links.length || !sections.length || typeof window.IntersectionObserver !== "function") return;

    function currentAtReadingLine() {
      var line = nav.getBoundingClientRect().bottom + 10;
      var next = null;
      sections.forEach(function (section) {
        var rect = section.getBoundingClientRect();
        if (rect.top <= line && rect.bottom > line) next = section;
      });
      if (!next) {
        sections.forEach(function (section) {
          var rect = section.getBoundingClientRect();
          if (rect.bottom > line && (!next || rect.top < next.getBoundingClientRect().top)) next = section;
        });
      }
      if (!next && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        next = sections[sections.length - 1];
      }
      return next;
    }

    function refresh() {
      var section = currentAtReadingLine();
      if (!section) return;
      var link = links.find(function (item) { return item.getAttribute("href") === "#" + section.id; });
      if (link) activateTab(link, links);
    }

    function observe() {
      if (nav._reportObserver) nav._reportObserver.disconnect();
      var header = document.getElementById("header");
      var topOffset = (header ? header.getBoundingClientRect().height : 0) + nav.getBoundingClientRect().height + 12;
      var observer = new IntersectionObserver(function () {
        refresh();
      }, {
        rootMargin: "-" + Math.round(topOffset) + "px 0px -62% 0px",
        threshold: 0
      });
      sections.forEach(function (section) { observer.observe(section); });
      nav._reportObserver = observer;
      refresh();
    }

    links.forEach(function (link) {
      link.addEventListener("click", function () { activateTab(link, links); });
    });
    observe();
    window.addEventListener("resize", observe, { passive: true });
  }

  function showTooltip(wrapper, tip, bar) {
    var text = bar.getAttribute("data-report-tooltip") || "";
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    var wrapperRect = wrapper.getBoundingClientRect();
    var barRect = bar.getBoundingClientRect();
    var x = barRect.left - wrapperRect.left + wrapper.scrollLeft + barRect.width / 2;
    var y = barRect.top - wrapperRect.top + wrapper.scrollTop - tip.offsetHeight - 7;
    var half = tip.offsetWidth / 2;
    x = Math.max(half + 6, Math.min(wrapper.clientWidth - half - 6, x));
    tip.style.left = x + "px";
    tip.style.top = Math.max(4, y) + "px";
  }

  function initChartTooltips() {
    var charts = document.querySelectorAll("[data-report-chart]");
    Array.prototype.forEach.call(charts, function (chart) {
      var wrapper = chart.closest(".cusin-chart-scroll");
      var tip = wrapper && wrapper.querySelector("[data-report-tooltip-role]");
      if (!wrapper || !tip) return;

      function hide() { tip.hidden = true; }
      function barFrom(target) {
        return target && target.closest ? target.closest("[data-cusin-chart-bar]") : null;
      }
      chart.addEventListener("mouseover", function (event) {
        var bar = barFrom(event.target);
        if (bar) showTooltip(wrapper, tip, bar);
      });
      chart.addEventListener("focusin", function (event) {
        var bar = barFrom(event.target);
        if (bar) showTooltip(wrapper, tip, bar);
      });
      chart.addEventListener("click", function (event) {
        var bar = barFrom(event.target);
        if (bar) showTooltip(wrapper, tip, bar);
        else hide();
      });
      chart.addEventListener("mouseout", function (event) {
        if (barFrom(event.target)) hide();
      });
      wrapper.addEventListener("scroll", hide, { passive: true });
      document.addEventListener("pointerdown", function (event) {
        if (!wrapper.contains(event.target)) hide();
      }, { passive: true });
    });
  }

  function announce(button) {
    var original = button.getAttribute("data-original-label") || button.textContent;
    button.setAttribute("data-original-label", original);
    button.textContent = LIVE_TEXT;
    button.classList.add("is-copied");
    window.setTimeout(function () {
      button.textContent = original;
      button.classList.remove("is-copied");
    }, 1600);
  }

  function fallbackCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } catch (error) {
      /* Nothing else to try in browsers without Clipboard API access. */
    }
    document.body.removeChild(area);
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function initPhoneCopy() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-cusin-copy]");
      if (!button) return;
      var value = button.getAttribute("data-cusin-copy") || "";
      if (!value) return;
      copy(value).then(function () {
        announce(button);
      }).catch(function () {
        /* Clipboard denied: leave the control unchanged. */
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initSectionTabs();
    initChartTooltips();
    initPhoneCopy();
  });
})();
