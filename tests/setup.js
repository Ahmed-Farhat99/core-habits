import moment from "moment";

window.moment = moment;

if (typeof Element !== "undefined") {
  if (!Element.prototype.empty) {
    Element.prototype.empty = function() {
      this.innerHTML = "";
    };
  }
  if (!Element.prototype.addClass) {
    Element.prototype.addClass = function(...classes) {
      this.classList.add(...classes);
    };
  }
  if (!Element.prototype.removeClass) {
    Element.prototype.removeClass = function(...classes) {
      this.classList.remove(...classes);
    };
  }
  if (!Element.prototype.toggleClass) {
    Element.prototype.toggleClass = function(className, state) {
      if (typeof state === "boolean") {
        if (state) this.classList.add(className);
        else this.classList.remove(className);
      } else {
        this.classList.toggle(className);
      }
    };
  }
  if (!Element.prototype.createEl) {
    Element.prototype.createEl = function(tag, options = {}) {
      const el = document.createElement(tag);
      if (options.cls) {
        if (Array.isArray(options.cls)) el.classList.add(...options.cls);
        else el.className = options.cls;
      }
      if (options.text) el.textContent = options.text;
      if (options.attr) {
        Object.entries(options.attr).forEach(([k, v]) => el.setAttribute(k, v));
      }
      if (options.type) el.type = options.type;
      if (options.placeholder) el.placeholder = options.placeholder;
      if (options.value) el.value = options.value;
      if (options.title) el.title = options.title;
      this.appendChild(el);
      return el;
    };
  }
  if (!Element.prototype.createDiv) {
    Element.prototype.createDiv = function(options = {}) {
      return this.createEl("div", options);
    };
  }
  if (!Element.prototype.createSpan) {
    Element.prototype.createSpan = function(options = {}) {
      return this.createEl("span", options);
    };
  }
}

