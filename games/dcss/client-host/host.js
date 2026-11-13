// SPDX-License-Identifier: GPL-2.0-or-later
/*
 * Rogue Archive host for upstream's WebTiles game client.
 *
 * On a WebTiles server the game client (game/*.js, shipped with each DCSS
 * version) runs inside the server's lobby page, which provides two modules:
 * "comm" (messages over a WebSocket) and "client" (message queueing, layers,
 * delays and keyboard handling). This file provides those two modules for a
 * single local player, connected through the adapter (window.frameElement's
 * raBridge) to the game in a Web Worker. The message queue, delay and keyboard
 * logic follow upstream's webserver/static/scripts/client.js and comm.js.
 *
 * Bridge (set by the adapter on the iframe element before it loads):
 *   raBridge.send(text)         a control message for the game
 *   raBridge.ready(api)         called once the client is loaded, with:
 *     api.receive(lines)        messages from the game (JSON text each)
 *     api.key(input)            a key from the shell (dock, keyboard, ...)
 *     api.restart()             a new game process started: reset the client
 *     api.setClasses(classes)   presentation classes for <html> (e.g. compact)
 *     api.relayout()            re-fit the client to the frame
 *   raBridge.focusShell()       hand keyboard focus back to the page
 */
(function () {
  'use strict';
  var bridge = window.frameElement && window.frameElement.raBridge;
  if (!bridge) {
    document.body.textContent = 'This page is part of Rogue Archive and runs inside the game player.';
    return;
  }

  // Globals the lobby (client.js) defines and the game client uses.
  window.assert = function () {};
  window.abs = function (x) {
    return x < 0 ? -x : x;
  };
  window.log = function (text) {
    console.log(text);
  };

  require.config({
    baseUrl: 'scripts',
    paths: { jquery: 'contrib/jquery', game: '../game' },
    // Plain jQuery plugins: load after jQuery.
    shim: { 'contrib/jquery.json': ['jquery'] },
    waitSeconds: 0,
  });

  define('comm', ['jquery'], function ($) {
    var message_handlers = {};
    var immediate_handlers = {};

    function send_keycode(code) {
      bridge.send('{"msg":"key","keycode":' + code + '}');
    }

    function send_message(msg, data) {
      data = data || {};
      data.msg = msg;
      if (msg === 'input') {
        // A WebTiles server writes this to the game's terminal. Headless
        // games have none, so each character becomes a key message.
        if (typeof data.text === 'string') {
          for (var ch of data.text) send_keycode(ch.codePointAt(0));
        }
        if (Array.isArray(data.data)) data.data.forEach(send_keycode);
        return;
      }
      bridge.send(JSON.stringify(data));
    }

    function handle_message(msg) {
      var handler = message_handlers[msg.msg];
      if (!handler) {
        console.error('Unknown message type: ' + msg.msg);
        return;
      }
      handler(msg);
    }

    function handle_message_immediately(msg) {
      var handler = immediate_handlers[msg.msg];
      return handler ? handler(msg) : false;
    }

    return {
      send_message: send_message,
      send_keycode: send_keycode,
      register_handlers: function (dict) {
        $.extend(message_handlers, dict);
      },
      register_immediate_handlers: function (dict) {
        $.extend(immediate_handlers, dict);
      },
      handle_message: handle_message,
      handle_message_immediately: handle_message_immediately,
    };
  });

  define('client', ['jquery', 'comm', 'key_conversion'], function ($, comm, key_conversion) {
    var exports = {};
    var message_queue = [];
    var message_inhibit = 0;
    var delay_timeout;
    var current_layer = 'loader';
    var layers = ['crt', 'normal'];

    function handle_message_backlog() {
      while (message_queue.length && message_inhibit === 0) {
        var msg = message_queue.shift();
        try {
          comm.handle_message(msg);
        } catch (err) {
          console.error('Error in message:', msg);
          console.error(err);
        }
      }
    }

    function inhibit_messages() {
      message_inhibit++;
    }
    function uninhibit_messages() {
      if (message_inhibit > 0) message_inhibit--;
      handle_message_backlog();
    }

    function delay(ms) {
      if (!document.hidden) {
        clearTimeout(delay_timeout);
        inhibit_messages();
        delay_timeout = setTimeout(function () {
          delay_timeout = undefined;
          uninhibit_messages();
        }, ms);
      }
    }

    function receive(lines) {
      for (var i = 0; i < lines.length; i++) {
        var msgobj;
        try {
          msgobj = JSON.parse(lines[i]);
        } catch (e) {
          console.error('Parsing error:', e, lines[i]);
          continue;
        }
        var msgs = msgobj.msgs == null ? [msgobj] : msgobj.msgs;
        for (var j = 0; j < msgs.length; j++) {
          adjust(msgs[j]);
          if (!comm.handle_message_immediately(msgs[j])) message_queue.push(msgs[j]);
        }
      }
      handle_message_backlog();
    }

    /**
     * Phones show fewer message lines so the map has room (the shell's log
     * keeps the history). The pane is only a view: the game's own message
     * window is unchanged.
     */
    var PHONE_MESSAGE_LINES = 4;
    function adjust(msg) {
      if (
        msg.msg === 'layout' &&
        msg.message_pane &&
        document.documentElement.classList.contains('compact')
      ) {
        msg.message_pane.height = Math.min(msg.message_pane.height, PHONE_MESSAGE_LINES);
      }
    }

    function in_game() {
      return current_layer !== 'loader';
    }

    function set_layer(layer) {
      layers.forEach(function (l) {
        if (l === layer) $('#' + l).show();
        else $('#' + l).hide();
      });
      current_layer = layer;
    }

    function center_element(elem) {
      var left = Math.max(0, $(window).width() / 2 - elem.outerWidth() / 2);
      var top = Math.min(50, Math.max(0, $(window).height() / 2 - elem.outerHeight() / 2));
      var offset = elem.offset();
      if (offset.left !== left || offset.top !== top) elem.offset({ left: left, top: top });
    }

    // --- Keyboard: as upstream client.js handle_keypress / handle_keydown ---

    function retrigger_event(ev, new_type) {
      var new_ev = $.extend({}, ev);
      new_ev.type = new_type;
      $(new_ev.target).trigger(new_ev);
      if (new_ev.isDefaultPrevented()) ev.preventDefault();
      if (new_ev.isPropagationStopped()) {
        ev.stopImmediatePropagation();
        return false;
      }
      return true;
    }

    function is_text_field(element) {
      return $(element).hasClass('text');
    }

    function handle_keypress(e) {
      if (!in_game()) return;
      if (is_text_field(document.activeElement)) return;
      if (e.isDefaultPrevented()) return;
      if (e.ctrlKey || e.altKey) {
        if (!e.ctrlKey || !e.altKey) return; // AltGr arrives as Ctrl+Alt
      }
      if (e.which === 0 || e.which === 8 || e.which === 9) return;
      if (!retrigger_event(e, 'game_keypress')) return;
      e.preventDefault();
      comm.send_message('input', { text: String.fromCharCode(e.which) });
    }

    function handle_keydown(e) {
      if (!in_game()) return;
      if (is_text_field(document.activeElement)) return;
      var code = e.originalEvent && e.originalEvent.code ? e.originalEvent.code : e.code;
      // Normalize numpad keycodes for shift and ctrl mappings.
      if (code && e.which >= 48 && e.which <= 57 && /^Numpad[0-9]$/.test(code)) {
        e.which = 96 + Number(code.charAt(6));
      }
      if (!retrigger_event(e, 'game_keydown')) return;

      if (e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (e.which in key_conversion.ctrl) {
          e.preventDefault();
          comm.send_keycode(key_conversion.ctrl[e.which]);
        } else if ($.inArray(String.fromCharCode(e.which), key_conversion.captured_control_keys) !== -1) {
          e.preventDefault();
          comm.send_keycode(e.which - 'A'.charCodeAt(0) + 1);
        }
      } else if (!e.ctrlKey && e.shiftKey && !e.altKey) {
        if (e.which in key_conversion.shift) {
          e.preventDefault();
          comm.send_keycode(key_conversion.shift[e.which]);
        }
      } else if (e.ctrlKey && e.shiftKey && !e.altKey) {
        if (e.which in key_conversion.ctrlshift) {
          e.preventDefault();
          comm.send_keycode(key_conversion.ctrlshift[e.which]);
        }
      } else if (!e.ctrlKey && !e.shiftKey && e.altKey) {
        if (e.which < 32) return;
        e.preventDefault();
        comm.send_message('input', { data: [27, e.which] });
      } else if (!e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (
          key_conversion.codes &&
          key_conversion.code_conversion_enabled() &&
          code &&
          code in key_conversion.codes
        ) {
          e.preventDefault();
          comm.send_keycode(key_conversion.codes[code]);
        } else if (e.which in key_conversion.simple) {
          e.preventDefault();
          comm.send_keycode(key_conversion.simple[e.which]);
        } else if (e.which in key_conversion.legacy) {
          e.preventDefault();
          comm.send_keycode(key_conversion.legacy[e.which]);
        }
      }
    }

    // Shell shortcuts that belong to the page, not the game, even when the
    // game frame has keyboard focus.
    function shell_key(e) {
      var oe = e.originalEvent;
      if (!oe || !oe.isTrusted) return false;
      if (oe.key === 'F5' || oe.key === 'F11' || oe.key === 'F12' || oe.metaKey) return true;
      return false;
    }

    $(document).on('keypress.client', handle_keypress);
    $(document).on('keydown.client', function (e) {
      if (shell_key(e)) return;
      handle_keydown(e);
    });

    comm.register_handlers({
      multi: function (data) {
        var msg;
        while ((msg = data.msgs.pop())) message_queue.unshift(msg);
      },
      layer: function (data) {
        set_layer(data.layer);
      },
      html: function (data) {
        $('#' + data.id).html(data.content);
      },
    });

    exports.inhibit_messages = inhibit_messages;
    exports.uninhibit_messages = uninhibit_messages;
    exports.delay = delay;
    exports.in_game = in_game;
    exports.set_layer = set_layer;
    window.set_layer = set_layer;
    exports.register_layer = function (name) {
      if (layers.indexOf(name) === -1) layers.push(name);
    };
    exports.center_element = center_element;
    exports.is_watching = function () {
      return false;
    };
    exports.show_dialog = function () {};
    exports.hide_dialog = function () {};
    exports.receive = receive;
    return exports;
  });

  // Legacy keyCode for a key, as browsers report it in keydown.
  var NAMED_KEYS = {
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Escape: 27,
    ' ': 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Insert: 45,
    Delete: 46,
    Clear: 12,
  };
  var PUNCTUATION = {
    ';': 186,
    ':': 186,
    '=': 187,
    '+': 187,
    ',': 188,
    '<': 188,
    '-': 189,
    _: 189,
    '.': 190,
    '>': 190,
    '/': 191,
    '?': 191,
    '`': 192,
    '~': 192,
    '[': 219,
    '{': 219,
    '\\': 220,
    '|': 220,
    ']': 221,
    '}': 221,
    "'": 222,
    '"': 222,
  };
  var SHIFTED_DIGITS = {
    '!': 49,
    '@': 50,
    '#': 51,
    $: 52,
    '%': 53,
    '^': 54,
    '&': 55,
    '*': 56,
    '(': 57,
    ')': 48,
  };

  function legacy_keycode(key, code) {
    if (code && /^Numpad[0-9]$/.test(code)) return 96 + Number(code.charAt(6));
    if (key in NAMED_KEYS) return NAMED_KEYS[key];
    var f = /^F([0-9]{1,2})$/.exec(key);
    if (f) return 111 + Number(f[1]);
    if (key.length === 1) {
      var c = key.toUpperCase().charCodeAt(0);
      if ((c >= 65 && c <= 90) || (c >= 48 && c <= 57)) return c;
      if (key in PUNCTUATION) return PUNCTUATION[key];
      if (key in SHIFTED_DIGITS) return SHIFTED_DIGITS[key];
    }
    return 0;
  }

  function synthetic(type, init, legacy) {
    var event = new KeyboardEvent(type, init);
    // keyCode/charCode/which are not settable through the constructor.
    Object.defineProperty(event, 'keyCode', { value: legacy.keyCode });
    Object.defineProperty(event, 'charCode', { value: legacy.charCode });
    Object.defineProperty(event, 'which', { value: legacy.which });
    return event;
  }

  /** A key from the shell, delivered exactly as if typed into this frame. */
  function press(input) {
    var key = input.key;
    var mods = input.modifiers || {};
    var target =
      document.activeElement && document.activeElement !== document.body
        ? document.activeElement
        : document.body;
    var init = {
      key: key,
      code: input.code || '',
      shiftKey: !!mods.shift,
      ctrlKey: !!mods.ctrl,
      altKey: !!mods.alt,
      bubbles: true,
      cancelable: true,
    };
    var keyCode = legacy_keycode(key, input.code);
    var down = synthetic('keydown', init, { keyCode: keyCode, charCode: 0, which: keyCode });
    var proceed = target.dispatchEvent(down);
    // Printable characters (and Enter) also produce keypress, unless the
    // keydown was handled. Ctrl+letter only does with Alt (AltGr).
    var printable = key.length === 1 || key === 'Enter';
    if (proceed && printable && (!mods.ctrl || mods.alt)) {
      var charCode = key === 'Enter' ? 13 : key.charCodeAt(0);
      target.dispatchEvent(
        synthetic('keypress', init, { keyCode: charCode, charCode: charCode, which: charCode }),
      );
      // A text field gets the character too (synthetic events don't type).
      if (key.length === 1 && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        var start = target.selectionStart;
        var end = target.selectionEnd;
        if (start != null && end != null) {
          target.value = target.value.slice(0, start) + key + target.value.slice(end);
          target.selectionStart = target.selectionEnd = start + 1;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
  }

  /**
   * Touch: a long press on the map describes that square. Upstream's client
   * does that on a right click; phones have none, so a held finger sends one
   * (and the tap's own click, which would travel there, is suppressed).
   */
  function attach_long_press() {
    var LONG_PRESS_MS = 450;
    var SLOP_PX = 12;
    var timer = null;
    var start = null;
    var fired = false;
    function cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
    document.addEventListener(
      'touchstart',
      function (event) {
        cancel();
        fired = false;
        var canvas = document.getElementById('dungeon');
        if (!canvas || event.target !== canvas || event.touches.length !== 1) return;
        var touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY };
        timer = setTimeout(function () {
          timer = null;
          fired = true;
          canvas.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              button: 2,
              buttons: 2,
              clientX: start.x,
              clientY: start.y,
            }),
          );
        }, LONG_PRESS_MS);
      },
      { passive: true },
    );
    document.addEventListener(
      'touchmove',
      function (event) {
        var touch = event.touches[0];
        if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > SLOP_PX)
          cancel();
      },
      { passive: true },
    );
    document.addEventListener(
      'touchend',
      function (event) {
        cancel();
        if (fired) event.preventDefault();
        fired = false;
      },
      { passive: false },
    );
    document.addEventListener('touchcancel', cancel, { passive: true });
  }

  function load_markup() {
    // Upstream's game.html, as the server would send it: without its script
    // (we load the client below) and stylesheets (index.html links them), and
    // with the server's per-version path pointing at our copy of the client.
    return fetch('game.html')
      .then(function (response) {
        return response.text();
      })
      .then(function (html) {
        return html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<link[^>]*>/gi, '')
          .replace(/\/gamedata\/\{\{\s*version\s*\}\}\//g, 'game/');
      });
  }

  /** Resolves once the tile sheets in the markup have loaded (as upstream's waitForImages). */
  function images_loaded(root) {
    var images = Array.prototype.slice.call(root.querySelectorAll('img'));
    return Promise.all(
      images.map(function (image) {
        if (image.complete) return null;
        return new Promise(function (resolve) {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        });
      }),
    );
  }

  // jQuery first: key_conversion.js (like the lobby) uses the global $ as it loads.
  require(['jquery'], function () {
    require(['jquery', 'client', 'comm'], function ($, client, comm) {
      load_markup().then(function (markup) {
        /** Fresh client state for a game process, as when the server sends the client. */
        function start() {
          client.inhibit_messages();
          $('#game').html(markup);
          $(document).trigger('game_preinit');
          $(document).trigger('game_init');
          return images_loaded(document.getElementById('game')).then(function () {
            client.uninhibit_messages();
          });
        }
        require(['game/game', 'game/minimap', 'game/enums'], function (game, minimap, enums) {
          attach_long_press();
          // Phones hide the stats column (it opens as a drawer), so the client
          // sizes the minimap beside it to zero width, and drawing a zero-size
          // canvas throws. Keep it at least one pixel per map cell.
          var fit_minimap = minimap.fit_to;
          minimap.fit_to = function (width) {
            var args = Array.prototype.slice.call(arguments);
            args[0] = Math.max(width || 0, enums.gxm);
            return fit_minimap.apply(this, args);
          };
          start().then(function () {
            bridge.ready({
              receive: client.receive,
              key: press,
              restart: function () {
                $(document).trigger('game_cleanup');
                start();
              },
              setClasses: function (classes) {
                document.documentElement.className = classes.join(' ');
              },
              relayout: function () {
                $(window).trigger('resize');
              },
              send: comm.send_message,
            });
          });
        });
      });
    });
  });
})();
